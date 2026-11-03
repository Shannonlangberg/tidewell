"use client";

import { useMemo, useState } from "react";
import { growthSeries, monthShort, MIX_LABEL, seriesIsEmpty, type Mix, type MonthPoint } from "@/lib/hq/ceo/rules";
import s from "./ceo.module.css";

/*
 * Managed properties over the last thirteen months: the managed count as a line (the current month, still
 * running, drawn dashed), with new managements above and lost ones below a baseline in the band underneath.
 * All, long-term or short-term. Hover or focus a month for its figures. Every point is a count of property
 * records (hq.ceo_overview series); nothing is smoothed or projected.
 */

const W = 640;
const TOP = 12;
const LINE_H = 150;
const BAND_TOP = TOP + LINE_H + 26;
const BAND_H = 44;
const H = BAND_TOP + BAND_H + 22;
const LEFT = 30;
const RIGHT = 8;

export function GrowthChart({ series }: { series: MonthPoint[] }) {
  const [mix, setMix] = useState<Mix>("all");
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => growthSeries(series, mix), [series, mix]);
  const empty = seriesIsEmpty(points);

  const n = points.length;
  const step = n > 1 ? (W - LEFT - RIGHT) / (n - 1) : 0;
  const x = (i: number) => LEFT + i * step;
  const maxManaged = Math.max(4, ...points.map((p) => p.managed));
  const niceMax = Math.ceil(maxManaged / 4) * 4;
  const y = (v: number) => TOP + LINE_H - (v / niceMax) * LINE_H;
  const maxFlow = Math.max(1, ...points.map((p) => Math.max(p.started, p.ended)));
  const half = BAND_H / 2;
  const mid = BAND_TOP + half;
  const flow = (v: number) => (v / maxFlow) * (half - 2);

  const solid = points.filter((p) => p.complete);
  const linePath = solid.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.managed).toFixed(1)}`).join(" ");
  const area = solid.length > 1 ? `${linePath} L${x(solid.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const lastIdx = n - 1;
  const ticks = [0, niceMax / 4, niceMax / 2, (3 * niceMax) / 4, niceMax];
  const barW = Math.max(6, Math.min(18, step * 0.38));
  const h = hover === null ? null : points[hover];

  return (
    <div>
      <div className={s.chartTools}>
        <div className={s.legend} aria-hidden="true">
          <span>
            <i className={s.swatchLine} /> Managed
          </span>
          <span>
            <i className={s.swatch} style={{ background: "var(--planted-clay)" }} /> New
          </span>
          <span>
            <i className={s.swatch} style={{ background: "var(--status-error-dot)" }} /> Lost
          </span>
        </div>
        <div className={s.miniTabs} role="group" aria-label="Which properties">
          {(Object.keys(MIX_LABEL) as Mix[]).map((m) => (
            <button key={m} type="button" className={s.miniTab} aria-pressed={mix === m} onClick={() => setMix(m)}>
              {MIX_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div className={s.chart} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Managed properties by month, ${MIX_LABEL[mix].toLowerCase()}: ${points.map((p) => `${monthShort(p.month)} ${p.managed}`).join(", ")}.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke="var(--planted-border)" strokeWidth="1" />
              <text x={LEFT - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--planted-grey-text)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {t}
              </text>
            </g>
          ))}
          <line x1={LEFT} x2={W - RIGHT} y1={mid} y2={mid} stroke="var(--planted-border)" strokeWidth="1" />
          {!empty && area ? <path d={area} fill="var(--planted-forest)" opacity="0.06" /> : null}
          {!empty && linePath ? <path d={linePath} fill="none" stroke="var(--planted-forest)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {!empty && n > 1 && !points[lastIdx].complete ? (
            <line x1={x(lastIdx - 1)} y1={y(points[lastIdx - 1].managed)} x2={x(lastIdx)} y2={y(points[lastIdx].managed)} stroke="var(--planted-forest)" strokeWidth="2" strokeDasharray="4 4" />
          ) : null}
          {points.map((p, i) => (
            <g key={p.month}>
              {p.started > 0 ? <rect x={x(i) - barW / 2} y={mid - flow(p.started)} width={barW} height={flow(p.started)} rx="2" fill="var(--planted-clay)" /> : null}
              {p.ended > 0 ? <rect x={x(i) - barW / 2} y={mid + 1} width={barW} height={flow(p.ended)} rx="2" fill="var(--status-error-dot)" opacity="0.8" /> : null}
              {!empty ? <circle cx={x(i)} cy={y(p.managed)} r={hover === i ? 4.5 : 2.5} fill="var(--planted-white)" stroke="var(--planted-forest)" strokeWidth="1.6" /> : null}
              {i % 2 === 0 || i === lastIdx ? (
                <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--planted-grey-text)">
                  {monthShort(p.month)}
                </text>
              ) : null}
              <rect
                x={x(i) - Math.max(step, 20) / 2}
                y={0}
                width={Math.max(step, 20)}
                height={H - 16}
                fill="transparent"
                tabIndex={0}
                role="presentation"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          ))}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BAND_TOP + BAND_H} stroke="var(--planted-sage)" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" /> : null}
        </svg>
        {h && hover !== null ? (
          <div className={s.chartTip} style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 75px), calc(100% - 160px))` }} aria-live="polite">
            <strong>
              {monthShort(h.month, true)}
              {h.complete ? "" : " (so far)"}
            </strong>
            {h.managed} managed
            <br />
            <span>
              +{h.started} new · −{h.ended} lost · net {h.net >= 0 ? `+${h.net}` : `−${-h.net}`}
            </span>
            <br />
            <span>{h.growthRate === null ? "No growth rate from zero" : `Growth ${h.growthRate >= 0 ? "+" : "−"}${Math.round(Math.abs(h.growthRate) * 1000) / 10}% on the month before`}</span>
          </div>
        ) : null}
        {empty ? (
          <p className={s.chartEmpty}>
            <strong>The line starts with the first management</strong>
            Each property recorded in Properties appears here from the month it began, with new and lost managements underneath.
          </p>
        ) : null}
      </div>
    </div>
  );
}
