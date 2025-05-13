import React, { useState } from "react";
import styles from "./ResultList.module.css";
import dynamic from "next/dynamic";
import { planFingerprintMap } from "./handleExecuteLogic";

// Dynamically import ReactApexChart to avoid SSR issues
const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResultListProps {
  results?: string[];
  preparationResults?: string[];
  planCount?: number;
  planFingerprintByCombination?: Record<string, number>;
}

// Helper to transform planFingerprintByCombination into ApexCharts heatmap data
function getHeatmapFromPlanFingerprint(planFingerprintByCombination: Record<string, number>) {
  // Parse keys like "i,j" into 2D array
  const keys = Object.keys(planFingerprintByCombination);
  const xSet = new Set<number>();
  const ySet = new Set<number>();
  keys.forEach(k => {
    const [x, y] = k.split(",").map(Number);
    xSet.add(x);
    ySet.add(y);
  });
  const xArr = Array.from(xSet).sort((a, b) => a - b);
  const yArr = Array.from(ySet).sort((a, b) => a - b);
  // Build 2D data array
  const data: number[][] = yArr.map(() => xArr.map(() => 0));
  keys.forEach(k => {
    const [x, y] = k.split(",").map(Number);
    const i = yArr.indexOf(y);
    const j = xArr.indexOf(x);
    data[i][j] = planFingerprintByCombination[k];
  });
  // Prepare ApexCharts heatmap series
  const series = data.map((row, i) => ({ name: `Y=${yArr[i]}`, data: row }));
  const options = {
    chart: { type: "heatmap" as const },
    dataLabels: { enabled: false },
    xaxis: { categories: xArr.map(x => x.toString()), title: { text: "Dimension 0" } },
    yaxis: { title: { text: "Dimension 1" } },
    colors: ["#008FFB"],
    title: { text: "Plan Fingerprint Heatmap" },
  };
  return { series, options };
}

// Arrow icon for collapsibles
const Arrow: React.FC<{ open: boolean }> = React.memo(({ open }) => (
  <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 6 }}>
    ▶
  </span>
));

Arrow.displayName = "Arrow";

// Heatmap visualization
const Heatmap: React.FC<{ planFingerprintByCombination?: Record<string, number> }> = ({ planFingerprintByCombination }) => {
  if (!planFingerprintByCombination || Object.keys(planFingerprintByCombination).length === 0) return null;
  const { series, options } = getHeatmapFromPlanFingerprint(planFingerprintByCombination);
  return (
    <div style={{ margin: "24px 0" }}>
      <ReactApexChart options={options} series={series} type="heatmap" height={350} />
    </div>
  );
};

Heatmap.displayName = "Heatmap";

// Number of plans info
const PlanCountInfo: React.FC<{ planCount?: number }> = ({ planCount }) => (
  planCount !== undefined && planFingerprintMap.size > 0 ? (
    <div className={styles.planCount}>Number of different plans: {planCount}</div>
  ) : null
);

// Plan fingerprint map list
const PlanFingerprintMapList: React.FC = () => (
  planFingerprintMap.size > 0 ? (
    <div className={styles.planFingerprintMapBox}>
      <h3><strong>Plan Fingerprint Map</strong></h3>
      <ul className={styles.planFingerprintMapList}>
        {[...planFingerprintMap.entries()].map(([fingerprint, id]) => (
          <li key={id} className={styles.planFingerprintMapItem}>
            <strong>Plan {id}:</strong>
            <pre className={styles.planFingerprintMapPlan}>{fingerprint}</pre>
          </li>
        ))}
      </ul>
    </div>
  ) : null
);

PlanFingerprintMapList.displayName = "PlanFingerprintMapList";

export default function ResultList({ results = [], preparationResults = [], planCount, planFingerprintByCombination }: ResultListProps) {
  const [showPreparation, setShowPreparation] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const hasExecuted = results.length > 0 || preparationResults.length > 0;

  return (
    <div className={styles.resultBox}>
      <Heatmap planFingerprintByCombination={planFingerprintByCombination} />
      <PlanCountInfo planCount={planCount} />
      <PlanFingerprintMapList />
      {/* Show collapsibles only if something was executed, otherwise show info text */}
      {hasExecuted ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 24 }}>
          <div style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center' }} onClick={() => setShowPreparation(v => !v)}>
            <Arrow open={showPreparation} />
            <strong className={styles.resultTitle}>Detailed Preparation Steps</strong>
          </div>
          {showPreparation && (
            <div className={styles.resultContent}>
              {preparationResults.length > 0 ? (
                <ul className={styles.resultList}>
                  {preparationResults.map((prep, idx) => (
                    <li key={idx} className={styles.resultItem}>
                      <pre className={styles.preparation}>{prep}</pre>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className={styles.noPreparationResult}>No preparation steps</span>
              )}
            </div>
          )}
          <div style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', marginTop: 8 }} onClick={() => setShowSql(v => !v)}>
            <Arrow open={showSql} />
            <strong className={styles.resultTitle}>Detailed SQL Queries</strong>
          </div>
          {showSql && (
            <div className={styles.resultContent}>
              {results.length === 0 ? (
                <span className={styles.noResult}>No result</span>
              ) : (
                <ul className={styles.resultList}>
                  {results.map((sql, idx) => (
                    <li key={idx} className={styles.resultItem}>
                      <span className={styles.sql}>{sql}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.noResult} style={{textAlign: 'center'}}>Please execute a query</div>
      )}
    </div>
  );
}
