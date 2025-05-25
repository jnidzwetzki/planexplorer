import React, { useState } from "react";
import styles from "./ResultList.module.css";
import dynamic from "next/dynamic";
import { planFingerprintMap, planJsonById } from "./handleExecuteLogic";

// Dynamically import ReactApexChart to avoid SSR issues
const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResultListProps {
  results?: string[];
  preparationResults?: string[];
  planFingerprintByCombination: Record<string, number>;
  dim0Name: string;
  dim1Name: string;
  sampled?: boolean;
  sampleCount?: number;
  totalExecutions?: number;
}

// Helper to transform planFingerprintByCombination into ApexCharts heatmap data
function getHeatmapFromPlanFingerprint(planFingerprintByCombination: Record<string, number>, dim0Name: string, dim1Name: string) {
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
  const series = data.map((row, i) => ({ name: `${yArr[i]}`, data: row }));
  const options = {
    chart: { type: "heatmap" as const },
    dataLabels: { enabled: false },
    xaxis: { categories: xArr.map(x => x.toString()), title: { text: dim0Name } },
    yaxis: yArr.length > 1 ? { title: { text: dim1Name } } : { show: false },
    grid: { padding: { left: 5, right: 5, bottom: 5, top: 5 } },
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
const Heatmap: React.FC<{ planFingerprintByCombination: Record<string, number>, dim0Name: string, dim1Name: string }> = React.memo(
  ({ planFingerprintByCombination, dim0Name, dim1Name }) => {
    if (!planFingerprintByCombination || Object.keys(planFingerprintByCombination).length === 0) return null;
    const keys = Object.keys(planFingerprintByCombination);
    const ySet = new Set<number>();
    keys.forEach(k => {
      const [, y] = k.split(",").map(Number);
      ySet.add(y);
    });
    const yArr = Array.from(ySet);
    // Minimum height 350, add 30px per y-entry above 10
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const { series, options } = getHeatmapFromPlanFingerprint(planFingerprintByCombination, dim0Name, dim1Name);
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={options} series={series} type="heatmap" height={height} />
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if the relevant props actually changed
    return (
      prevProps.dim0Name === nextProps.dim0Name &&
      prevProps.dim1Name === nextProps.dim1Name &&
      Object.keys(prevProps.planFingerprintByCombination).length === Object.keys(nextProps.planFingerprintByCombination).length &&
      Object.entries(prevProps.planFingerprintByCombination).every(([k, v]) => nextProps.planFingerprintByCombination[k] === v)
    );
  }
);

Heatmap.displayName = "Heatmap";

// Number of plans info (always show live count from planFingerprintMap)
const PlanCountInfo: React.FC = () => (
  planFingerprintMap.size > 0 ? (
    <div className={styles.planCount}>Number of different plans: {planFingerprintMap.size}</div>
  ) : null
);

// Plan fingerprint map list
const PlanFingerprintMapList: React.FC<{ planUsageCount: Record<number, number>, hasExecuted: boolean }> = ({ planUsageCount, hasExecuted }) => {
  // Track open/closed state for each plan by ID
  const [openPlans, setOpenPlans] = useState<Record<number, boolean>>({});
  const togglePlan = (id: number) => {
    setOpenPlans(prev => ({ ...prev, [id]: !prev[id] }));
  };
  return planFingerprintMap.size > 0 ? (
    <div className={styles.planFingerprintMapBox}>
      <h3><strong>Plan Fingerprints</strong></h3>
      <ul className={styles.planFingerprintMapList}>
        {[...planFingerprintMap.entries()].map(([fingerprint, id]) => (
          <li key={id} className={styles.planFingerprintMapItem}>
            <div style={{display: 'flex', alignItems: 'center', cursor: 'pointer'}} onClick={() => togglePlan(id)}>
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: openPlans[id] ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 6 }}>▶</span>
              <strong>Plan {id}</strong>
              {/* Only show usage count if hasExecuted is true */}
              {hasExecuted && (
                <span className={styles.planUsageCount}>
                  (Used {planUsageCount[id] || 0} times)
                </span>
              )}
            </div>
            <pre className={styles.planFingerprintMapPlan}>{fingerprint}</pre>
            {planJsonById.has(id) && openPlans[id] && (
              <>
                <div style={{marginTop: 8, fontWeight: 500}}>Full Query Plan:</div>
                <pre className={styles.planFingerprintMapPlan} style={{whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto'}}>
                  {planJsonById.get(id)}
                </pre>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
};

PlanFingerprintMapList.displayName = "PlanFingerprintMapList";

export default function ResultList({ results = [], preparationResults = [], planFingerprintByCombination, dim0Name, dim1Name, sampled, sampleCount, totalExecutions }: ResultListProps) {
  const [showPreparation, setShowPreparation] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const hasExecuted = results.length > 0 || preparationResults.length > 0;

  // Count how often each plan is used
  const planUsageCount: Record<number, number> = {};
  Object.values(planFingerprintByCombination).forEach(id => {
    planUsageCount[id] = (planUsageCount[id] || 0) + 1;
  });

  // Show info text only if nothing was executed and no fingerprints present
  const showNoResultInfo = !hasExecuted && planFingerprintMap.size === 0;

  return (
    <div className={styles.resultBox}>
      <Heatmap planFingerprintByCombination={planFingerprintByCombination} dim0Name={dim0Name} dim1Name={dim1Name} />
      <PlanCountInfo />
      <PlanFingerprintMapList planUsageCount={planUsageCount} hasExecuted={hasExecuted} />
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
            {/* Show sample info if results are sampled */}
            {sampled && (
              <span className={styles.planUsageCount}>
                (Sampled {sampleCount} of {totalExecutions})
              </span>
            )}
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
        showNoResultInfo && (
          <div className={styles.noResult} style={{textAlign: 'center'}}>Please execute a query</div>
        )
      )}
    </div>
  );
}
