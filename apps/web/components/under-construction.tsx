"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Variant = "crane" | "mascot";

const STORAGE_KEY = "pilab.ucVariant";

type Props = {
  feature: string;
  backHref?: string;
  backLabel?: string;
  blurb?: string;
};

export function UnderConstruction({
  backHref = "/",
  backLabel = "overview",
  blurb,
  feature,
}: Props) {
  const [variant, setVariant] = useState<Variant>("crane");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "crane" || stored === "mascot") setVariant(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, variant);
    } catch {
      /* ignore */
    }
  }, [variant]);

  const lede =
    blurb ??
    `The ${feature} screen isn't ready yet — we wanted to ship the parts you'd use today rather than a half-built version of everything. Come back next week; we'll have the saw down by then.`;

  return (
    <div className="uc-page">
      <div className="uc-inner">
        <div className="uc-stage">{variant === "crane" ? <CraneSVG /> : <MascotSVG />}</div>
        <div className="uc-eyebrow">
          <span className="dot" />
          Under construction · ETA soon
        </div>
        <h1 className="uc-title">
          {variant === "crane" ? (
            <>
              We&apos;re <em>still hammering</em> on this.
            </>
          ) : (
            <>
              Our little <em>builder</em> is busy.
            </>
          )}
        </h1>
        <p className="uc-lede">{lede}</p>
        <div className="uc-progress" aria-hidden="true">
          <div className="bar">
            <i />
          </div>
          <div className="label">
            <span>spec</span>
            <span>design</span>
            <span>build</span>
            <span>ship</span>
          </div>
        </div>
        <div className="uc-cta">
          <Link className="button" href={backHref}>
            ← Back to {backLabel}
          </Link>
          <Link className="button primary" href="/experiments/new">
            Run an experiment instead
          </Link>
        </div>
        <button
          className="uc-variant"
          onClick={() => setVariant(variant === "crane" ? "mascot" : "crane")}
          type="button"
        >
          Show {variant === "crane" ? "mascot" : "crane"}
        </button>
      </div>
    </div>
  );
}

function CraneSVG() {
  return (
    <svg className="uc-crane" viewBox="0 0 280 220" aria-hidden="true">
      <line
        x1="20"
        y1="206"
        x2="260"
        y2="206"
        stroke="#d8d3cc"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
      <g className="cloud" opacity="0.5">
        <ellipse cx="60" cy="40" rx="22" ry="8" fill="#e8e2d8" />
        <ellipse cx="78" cy="36" rx="14" ry="6" fill="#e8e2d8" />
      </g>
      <g className="cloud" opacity="0.35" style={{ animationDelay: "-6s", animationDuration: "18s" }}>
        <ellipse cx="220" cy="30" rx="18" ry="6" fill="#e8e2d8" />
      </g>
      <g className="base">
        <rect x="135" y="60" width="10" height="146" fill="#2a2825" />
        <path
          d="M135 80 L145 90 M145 80 L135 90 M135 110 L145 120 M145 110 L135 120 M135 140 L145 150 M145 140 L135 150 M135 170 L145 180 M145 170 L135 180"
          stroke="#1a1816"
          strokeWidth="1"
        />
        <rect x="60" y="58" width="180" height="6" fill="#2a2825" />
        <rect x="118" y="48" width="28" height="14" fill="#ff6a00" />
        <rect x="122" y="51" width="8" height="8" fill="#fff3e6" />
        <rect x="50" y="55" width="14" height="14" fill="#2a2825" />
        <line x1="200" y1="64" x2="200" y2="100" stroke="#2a2825" strokeWidth="1.2" />
      </g>
      <g className="hook">
        <line x1="200" y1="64" x2="200" y2="120" stroke="#2a2825" strokeWidth="1" />
        <path d="M196 120 L204 120 L204 128 Q200 134 200 134 Q200 134 196 128 Z" fill="#2a2825" />
        <g className="crate">
          <rect x="178" y="135" width="44" height="34" fill="#d4a373" stroke="#8a5a2b" strokeWidth="1.5" />
          <path d="M178 152 L222 152 M200 135 L200 169" stroke="#8a5a2b" strokeWidth="1" />
          <text
            x="200"
            y="158"
            fontFamily="ui-monospace,monospace"
            fontSize="7"
            fill="#5a3a1b"
            textAnchor="middle"
            letterSpacing="0.5"
          >
            FRAGILE
          </text>
        </g>
      </g>
      <g transform="translate(85,72)">
        <circle className="spark s1" cx="0" cy="0" r="2" fill="#ff6a00" />
        <circle className="spark s2" cx="6" cy="4" r="1.5" fill="#ffb060" />
        <circle className="spark s3" cx="-5" cy="3" r="1.5" fill="#ff6a00" />
      </g>
      <g transform="translate(80, 186)">
        <circle cx="0" cy="-12" r="4" fill="#f0c896" />
        <path d="M-3 -16 Q0 -19 3 -16 L4 -14 L-4 -14 Z" fill="#ff6a00" />
        <rect x="-3" y="-8" width="6" height="10" fill="#3b6cb5" />
        <line x1="-3" y1="-4" x2="-8" y2="2" stroke="#f0c896" strokeWidth="2" />
        <line x1="3" y1="-4" x2="8" y2="-2" stroke="#f0c896" strokeWidth="2" />
        <line x1="-2" y1="2" x2="-3" y2="10" stroke="#2a2825" strokeWidth="2" />
        <line x1="2" y1="2" x2="3" y2="10" stroke="#2a2825" strokeWidth="2" />
      </g>
    </svg>
  );
}

function MascotSVG() {
  return (
    <svg className="uc-mascot" viewBox="0 0 280 220" aria-hidden="true">
      <line
        x1="20"
        y1="200"
        x2="260"
        y2="200"
        stroke="#d8d3cc"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
      <g opacity="0.6">
        <rect x="40" y="194" width="14" height="4" rx="1" fill="#8a5a2b" />
        <circle cx="56" cy="196" r="4" fill="none" stroke="#8a5a2b" strokeWidth="1.2" />
        <path d="M240 198 L246 192 L250 196 L244 202 Z" fill="#666" />
      </g>
      <g className="body">
        <ellipse cx="140" cy="160" rx="48" ry="40" fill="#ff6a00" />
        <ellipse cx="140" cy="170" rx="32" ry="24" fill="#ffd9b8" />
        <circle cx="140" cy="110" r="36" fill="#ff6a00" />
        <path d="M104 102 Q104 80 140 78 Q176 80 176 102 Z" fill="#ffd23f" />
        <rect x="106" y="100" width="68" height="4" fill="#e0a500" />
        <rect x="136" y="78" width="8" height="6" fill="#e0a500" />
        <g className="eye-l">
          <circle cx="128" cy="116" r="6" fill="#fff" />
          <circle cx="129" cy="117" r="3" fill="#1a1816" />
          <circle cx="130" cy="116" r="1" fill="#fff" />
        </g>
        <g className="eye-r">
          <circle cx="152" cy="116" r="6" fill="#fff" />
          <circle cx="153" cy="117" r="3" fill="#1a1816" />
          <circle cx="154" cy="116" r="1" fill="#fff" />
        </g>
        <path
          d="M132 128 Q140 134 148 128"
          stroke="#1a1816"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="120" cy="126" r="3" fill="#ff9a55" opacity="0.7" />
        <circle cx="160" cy="126" r="3" fill="#ff9a55" opacity="0.7" />
        <ellipse cx="118" cy="198" rx="12" ry="4" fill="#1a1816" />
        <ellipse cx="162" cy="198" rx="12" ry="4" fill="#1a1816" />
        <path
          d="M100 150 Q88 158 92 172"
          stroke="#ff6a00"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="86" y="170" width="3" height="14" fill="#888" />
        <circle cx="87.5" cy="170" r="2.5" fill="#888" />
      </g>
      <g className="hammer">
        <path
          d="M180 140 Q210 130 225 105"
          stroke="#ff6a00"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="218" y="92" width="3" height="22" fill="#8a5a2b" transform="rotate(10 219 103)" />
        <rect
          x="208"
          y="80"
          width="22"
          height="14"
          rx="2"
          fill="#666"
          transform="rotate(10 219 87)"
        />
      </g>
      <g className="impact" transform="translate(95, 175)">
        <path d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2 Z" fill="#ffd23f" />
        <text
          x="14"
          y="3"
          fontFamily="ui-monospace,monospace"
          fontSize="11"
          fontWeight="700"
          fill="#ff6a00"
        >
          BANG!
        </text>
      </g>
    </svg>
  );
}
