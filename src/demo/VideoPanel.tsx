import { useEffect, useRef, useState } from 'react';

import { appConfig } from '../config';
import { nowMs } from '../domain/clock';
import { deadReckon, fadeAlpha } from '../domain/motion';
import { trackBuffer } from '../net/feed';
import {
  DEMO_GEO_POINTS,
  DEMO_VIDEO_SIZE,
  DEMO_VIDEO_URL,
  trackColor,
} from './demoData';
import { expectedVideoTime } from './demoClock';
import { applyHomography, homographyFromPoints, type Homography } from './homography';

/**
 * Demo overlay TTL: the feed removes a track about 1 s after its last
 * observation (`feed.track_ttl_s` in `configs/map_feed_aire.yaml`), so fading
 * over the same window lets the marker disappear instead of hanging and then
 * popping out. The live app keeps its own, longer `trackTtlMs` safety net.
 */
const DEMO_TRACK_TTL_MS = 1100;
/** Re-seek when the drift between data time and video time exceeds this. */
const SEEK_THRESHOLD_S = 0.4;
/** Inside this band the playback rate is trimmed instead of seeking. */
const RATE_THRESHOLD_S = 0.08;

interface VideoPanelProps {
  /** Demo start time; the video waits for it so the replay and the frame agree. */
  enabled: boolean;
}

/**
 * Camera video with a CarsCounting-style canvas overlay driven by the live WS
 * feed: one colour per object ID, its trail and a speed tag. The overlay is
 * projected from WGS-84 back to image pixels with the inverse of the
 * `geo_bind.ini` homography.
 */
export function VideoPanel({ enabled }: VideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const homography = homographyFromPoints(DEMO_GEO_POINTS);
    if (!homography) {
      return;
    }

    let frame = 0;

    const syncPlayback = (video: HTMLVideoElement): void => {
      const expected = expectedVideoTime();
      if (expected === null) {
        return;
      }
      if (!startedRef.current) {
        if (video.readyState >= 2) {
          video.currentTime = expected;
          void video.play().catch(() => setFailed(true));
          startedRef.current = true;
        }
        return;
      }
      if (video.paused || video.ended) {
        return;
      }
      const drift = video.currentTime - expected;
      if (Math.abs(drift) > SEEK_THRESHOLD_S) {
        video.currentTime = expected;
        video.playbackRate = 1;
      } else if (Math.abs(drift) > RATE_THRESHOLD_S) {
        video.playbackRate = drift > 0 ? 0.97 : 1.03;
      } else {
        video.playbackRate = 1;
      }
    };

    const project = (h: Homography, lon: number, lat: number, width: number, height: number) => {
      const point = applyHomography(h, lon, lat);
      return { x: point.x * width, y: point.y * height };
    };

    const drawLabel = (
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      color: string,
    ) => {
      ctx.font = '600 12px Inter, Segoe UI, system-ui, sans-serif';
      const metrics = ctx.measureText(text);
      const paddingX = 5;
      const boxWidth = metrics.width + paddingX * 2;
      const boxHeight = 17;
      const boxX = x + 9;
      const boxY = y - 20;
      ctx.fillStyle = 'rgba(7, 11, 20, 0.72)';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(text, boxX + paddingX, boxY + 12.5);
    };

    const drawTrack = (
      ctx: CanvasRenderingContext2D,
      track: ReturnType<typeof trackBuffer.list>[number],
      head: { x: number; y: number; lon: number; lat: number },
      width: number,
      height: number,
      alpha: number,
    ) => {
      const color = trackColor(track.id);

      // Trail history as a fading polyline.
      if (track.trail.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < track.trail.length; i += 1) {
          const [lon, lat] = track.trail[i];
          const point = project(homography, lon, lat, width, height);
          if (i === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        }
        ctx.lineTo(head.x, head.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55 * alpha;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }

      const speed = track.speedKmh;

      // Marker: one dot per object, colour = identity.
      ctx.beginPath();
      ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(7, 11, 20, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      drawLabel(
        ctx,
        `#${track.id} · ${Math.round(speed)} км/ч`,
        head.x,
        head.y,
        color,
      );
      ctx.globalAlpha = 1;
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        return;
      }
      if (enabled) {
        syncPlayback(video);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (
        canvas.width !== Math.round(cssWidth * dpr) ||
        canvas.height !== Math.round(cssHeight * dpr)
      ) {
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const now = nowMs();
      const ttl = Math.min(appConfig.trackTtlMs, DEMO_TRACK_TTL_MS);
      for (const track of trackBuffer.list()) {
        const ageMs = now - track.lastSeen;
        if (ageMs > ttl) {
          continue;
        }
        const alpha = fadeAlpha(ageMs, ttl);
        const dead = deadReckon(track, now);
        const head = project(homography, dead[0], dead[1], cssWidth, cssHeight);
        drawTrack(ctx, track, { x: head.x, y: head.y, lon: dead[0], lat: dead[1] }, cssWidth, cssHeight, alpha);
      }
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return (
    <div className="video-shell">
      {failed && <div className="video-error">Видео недоступно: {DEMO_VIDEO_URL}</div>}
      <video
        ref={videoRef}
        className="video-frame"
        src={DEMO_VIDEO_URL}
        muted
        playsInline
        preload="auto"
        width={DEMO_VIDEO_SIZE.width}
        height={DEMO_VIDEO_SIZE.height}
      />
      <canvas ref={canvasRef} className="video-overlay" />
    </div>
  );
}
