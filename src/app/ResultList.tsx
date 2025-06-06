import React, { useState } from "react";
import styles from "./ResultList.module.css";
import dynamic from "next/dynamic";
import { planFingerprintMap, planJsonById, planFingerprintByCombination } from "./handleExecuteLogic";

// Dynamically import ReactApexChart to avoid SSR issues
const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface QueryResult {
  query: string;
  result?: Record<string, unknown> | unknown[];
  error?: string;
  combinationKey?: string;
}

interface ResultListProps {
  results?: QueryResult[];
  dim0Name: string;
  dim1Name: string;
  isExecuting: boolean;
}

// Helper to generate ApexCharts heatmap options
function getHeatmapOptions(xArr: number[], yArr: number[], dim0Name: string, dim1Name: string) {
  return {
    chart: { type: "heatmap" as const },
    dataLabels: { enabled: false },
    xaxis: { categories: xArr.map(x => x.toString()), title: { text: dim0Name } },
    yaxis: yArr.length > 1 ? { title: { text: dim1Name } } : { show: false },
    grid: { padding: { left: 5, right: 5, bottom: 5, top: 5 } },
    colors: ["#008FFB"],
    title: { text: "Plan Fingerprint Heatmap" },
  };
}

// Helper to transform planFingerprintByCombination into ApexCharts heatmap series
function getHeatmapFromPlanFingerprint(planFingerprintByCombination: Map<string, number>) {
  const keys = Array.from(planFingerprintByCombination.keys());
  const getValue = (k: string) => planFingerprintByCombination.get(k);
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
    data[i][j] = getValue(k) ?? 0;
  });
  // Prepare ApexCharts heatmap series
  const series = data.map((row, i) => ({ name: `${yArr[i]}`, data: row }));
  return series;
}

// Helper to build a mapping from combinationKey to Total Cost directly from results
function getTotalCostByCombinationFromResults(results: QueryResult[]): Map<string, number> {
  const result = new Map<string, number>();
  results.forEach((r, idx) => {
    const combinationKey = r.combinationKey || String(idx);
    const data = r.result;
    if (!data || typeof data !== 'object' || !('rows' in data)) return;
    const rows = (data as { rows: unknown[] }).rows;
    const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    const explainJsonStr = explainRow && Object.values(explainRow)[0];
    if (explainJsonStr) {
      const parsed = typeof explainJsonStr === 'string' ? JSON.parse(explainJsonStr) : explainJsonStr;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].Plan) {
        const plan = parsed[0].Plan;
        if (typeof plan["Total Cost"] === "number") {
          result.set(combinationKey, plan["Total Cost"]);
        }
      }
    }
  });
  return result;
}

function getPlanRowsByCombinationFromResults(results: QueryResult[]): Map<string, number> {
  const result = new Map<string, number>();
  results.forEach((r, idx) => {
    const combinationKey = r.combinationKey || String(idx);
    const data = r.result;
    if (!data || typeof data !== 'object' || !('rows' in data)) return;
    const rows = (data as { rows: unknown[] }).rows;
    const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    const explainJsonStr = explainRow && Object.values(explainRow)[0];
    if (explainJsonStr) {
      const parsed = typeof explainJsonStr === 'string' ? JSON.parse(explainJsonStr) : explainJsonStr;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].Plan) {
        const plan = parsed[0].Plan;
        if (typeof plan["Plan Rows"] === "number") {
          result.set(combinationKey, plan["Plan Rows"]);
        }
      }
    }
  });
  return result;
}

function getActualRowsByCombinationFromResults(results: QueryResult[]): Map<string, number> {
  const result = new Map<string, number>();
  results.forEach((r, idx) => {
    const combinationKey = r.combinationKey || String(idx);
    const data = r.result;
    if (!data || typeof data !== 'object' || !('rows' in data)) return;
    const rows = (data as { rows: unknown[] }).rows;
    const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    const explainJsonStr = explainRow && Object.values(explainRow)[0];
    if (explainJsonStr) {
      const parsed = typeof explainJsonStr === 'string' ? JSON.parse(explainJsonStr) : explainJsonStr;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].Plan) {
        const plan = parsed[0].Plan;
        if (typeof plan["Actual Rows"] === "number") {
          result.set(combinationKey, plan["Actual Rows"]);
        }
      }
    }
  });
  return result;
}

function getActualTotalTimeByCombinationFromResults(results: QueryResult[]): Map<string, number> {
  const result = new Map<string, number>();
  results.forEach((r, idx) => {
    const combinationKey = r.combinationKey || String(idx);
    const data = r.result;
    if (!data || typeof data !== 'object' || !('rows' in data)) return;
    const rows = (data as { rows: unknown[] }).rows;
    const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    const explainJsonStr = explainRow && Object.values(explainRow)[0];
    if (explainJsonStr) {
      const parsed = typeof explainJsonStr === 'string' ? JSON.parse(explainJsonStr) : explainJsonStr;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].Plan) {
        const plan = parsed[0].Plan;
        if (typeof plan["Actual Total Time"] === "number") {
          result.set(combinationKey, plan["Actual Total Time"]);
        }
      }
    }
  });
  return result;
}

// Arrow icon for collapsibles
const Arrow: React.FC<{ open: boolean }> = React.memo(({ open }) => (
  <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 6 }}>
    ▶
  </span>
));

Arrow.displayName = "Arrow";

// Plan heatmap visualization
const PlanHeatmap: React.FC<{ dim0Name: string, dim1Name: string, planFingerprintByCombination: Map<string, number> }> = React.memo(
  ({ dim0Name, dim1Name, planFingerprintByCombination }) => {
    if (!planFingerprintByCombination || planFingerprintByCombination.size === 0) return null;
    const keys = Array.from(planFingerprintByCombination.keys());
    const ySet = new Set<number>();
    const xSet = new Set<number>();
    keys.forEach(k => {
      const [x, y] = k.split(",").map(Number);
      xSet.add(x);  
      ySet.add(y);
    });
    const xArr = Array.from(xSet).sort((a, b) => a - b);
    const yArr = Array.from(ySet);
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const series = getHeatmapFromPlanFingerprint(planFingerprintByCombination);
    const options = getHeatmapOptions(xArr, yArr, dim0Name, dim1Name);
    const chartOptions = {
      ...options,
      tooltip: {
        y: {
          formatter: (value: number) => {
            return `Query plan: ${value}`;
          }
        }
      }
    };
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={chartOptions} series={series} type="heatmap" height={height} />
      </div>
    );
  }
);

PlanHeatmap.displayName = "PlanHeatmap";

const bluePalette = [
  '#9400D3', // violet (dark)
  '#C71585', // medium violet red (dark)
  '#008000', // dark green
  '#00A100', // green
  '#1E90FF', // dodger blue
  '#128FD9', // blue
  '#00CFFF', // cyan
  '#00FF00', // bright green
  '#00FFFF', // aqua
  '#FF00FF', // magenta
  '#FF1493', // deep pink
  '#FF4500', // orange red
  '#FF6F00', // deep orange
  '#FF0000', // red
  '#FFB200', // yellow/orange
  '#FFD700'  // gold (brightest)
];

// Beispiel: So kann man die Palette in getCividisColorRanges nutzen
function getBlueColorRanges(min: number, max: number) {
  return Array.from({ length: bluePalette.length }, (_, i) => {
    const from = min + (i / bluePalette.length) * (max - min);
    const to = min + ((i + 1) / bluePalette.length) * (max - min);
    return {
      from,
      to,
      color: bluePalette[i],
      name: `${from.toFixed(0)} - ${to.toFixed(0)}`
    };
  });
}

// Total Cost heatmap visualization
const TotalCostHeatmap: React.FC<{ results: QueryResult[], dim0Name: string, dim1Name: string }> = React.memo(
  ({ results, dim0Name, dim1Name }) => {
    const totalCostByCombination = getTotalCostByCombinationFromResults(results);
    if (!totalCostByCombination || totalCostByCombination.size === 0) return null;
    const keys = Array.from(totalCostByCombination.keys());
    const ySet = new Set<number>();
    const xSet = new Set<number>();
    keys.forEach(k => {
      const [x, y] = k.split(",").map(Number);
      xSet.add(x);
      ySet.add(y);
    });
    const xArr = Array.from(xSet).sort((a, b) => a - b);
    const yArr = Array.from(ySet);
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const series = getHeatmapFromPlanFingerprint(totalCostByCombination);
    const allCosts = Array.from(totalCostByCombination.values());
    const min = Math.min(...allCosts);
    const max = Math.max(...allCosts);
    const ranges = getBlueColorRanges(min, max);
    const options = getHeatmapOptions(xArr, yArr, dim0Name, dim1Name);
    const chartOptions = {
      ...options,
      title: { text: "Total Cost Heatmap" },
      plotOptions: {
        heatmap: {
          colorScale: {
            ranges
          }
        }
      }
    };
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={chartOptions} series={series} type="heatmap" height={height} />
      </div>
    );
  }
);
TotalCostHeatmap.displayName = "TotalCostHeatmap";


// Actual Total Time heatmap visualization
const ActualTotalTimeHeatmap: React.FC<{ results: QueryResult[], dim0Name: string, dim1Name: string }> = React.memo(
  ({ results, dim0Name, dim1Name }) => {
    const actualTotalTimeByCombination = getActualTotalTimeByCombinationFromResults(results);
    if (!actualTotalTimeByCombination || actualTotalTimeByCombination.size === 0) return null;
    const keys = Array.from(actualTotalTimeByCombination.keys());
    const ySet = new Set<number>();
    const xSet = new Set<number>();
    keys.forEach(k => {
      const [x, y] = k.split(",").map(Number);
      xSet.add(x);
      ySet.add(y);
    });
    const xArr = Array.from(xSet).sort((a, b) => a - b);
    const yArr = Array.from(ySet);
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const series = getHeatmapFromPlanFingerprint(actualTotalTimeByCombination);
    const allTimes = Array.from(actualTotalTimeByCombination.values());
    const min = Math.min(...allTimes);
    const max = Math.max(...allTimes);
    const ranges = getBlueColorRanges(min, max);
    const options = getHeatmapOptions(xArr, yArr, dim0Name, dim1Name);
    const chartOptions = {
      ...options,
      title: { text: "Actual Total Time Heatmap" },
      plotOptions: {
        heatmap: {
          colorScale: {
            ranges
          }
        }
      }
    };
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={chartOptions} series={series} type="heatmap" height={height} />
      </div>
    );
  }
);
ActualTotalTimeHeatmap.displayName = "ActualTotalTimeHeatmap";

// Plan Rows heatmap visualization
const PlanRowsHeatmap: React.FC<{ results: QueryResult[], dim0Name: string, dim1Name: string }> = React.memo(
  ({ results, dim0Name, dim1Name }) => {
    const planRowsByCombination = getPlanRowsByCombinationFromResults(results);
    if (!planRowsByCombination || planRowsByCombination.size === 0) return null;
    const keys = Array.from(planRowsByCombination.keys());
    const ySet = new Set<number>();
    const xSet = new Set<number>();
    keys.forEach(k => {
      const [x, y] = k.split(",").map(Number);
      xSet.add(x);
      ySet.add(y);
    });
    const xArr = Array.from(xSet).sort((a, b) => a - b);
    const yArr = Array.from(ySet);
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const series = getHeatmapFromPlanFingerprint(planRowsByCombination);
    const allRows = Array.from(planRowsByCombination.values());
    const min = Math.min(...allRows);
    const max = Math.max(...allRows);
    const ranges = getBlueColorRanges(min, max);
    const options = getHeatmapOptions(xArr, yArr, dim0Name, dim1Name);
    const chartOptions = {
      ...options,
      title: { text: "Expected Result Tuples" },
      plotOptions: {
        heatmap: {
          colorScale: {
            ranges
          }
        }
      }
    };
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={chartOptions} series={series} type="heatmap" height={height} />
      </div>
    );
  }
);
PlanRowsHeatmap.displayName = "PlanRowsHeatmap";

// Actual Rows heatmap visualization
const ActualRowsHeatmap: React.FC<{ results: QueryResult[], dim0Name: string, dim1Name: string }> = React.memo(
  ({ results, dim0Name, dim1Name }) => {
    const actualRowsByCombination = getActualRowsByCombinationFromResults(results);
    if (!actualRowsByCombination || actualRowsByCombination.size === 0) return null;
    const keys = Array.from(actualRowsByCombination.keys());
    const ySet = new Set<number>();
    const xSet = new Set<number>();
    keys.forEach(k => {
      const [x, y] = k.split(",").map(Number);
      xSet.add(x);
      ySet.add(y);
    });
    const xArr = Array.from(xSet).sort((a, b) => a - b);
    const yArr = Array.from(ySet);
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const series = getHeatmapFromPlanFingerprint(actualRowsByCombination);
    const allRows = Array.from(actualRowsByCombination.values());
    const min = Math.min(...allRows);
    const max = Math.max(...allRows);
    const ranges = getBlueColorRanges(min, max);
    const options = getHeatmapOptions(xArr, yArr, dim0Name, dim1Name);
    const chartOptions = {
      ...options,
      title: { text: "Actual Tuples Heatmap" },
      plotOptions: {
        heatmap: {
          colorScale: {
            ranges
          }
        }
      }
    };
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={chartOptions} series={series} type="heatmap" height={height} />
      </div>
    );
  }
);
ActualRowsHeatmap.displayName = "ActualTuplesHeatmap";

// Diff (Actual Rows - Plan Rows) heatmap visualization
const DiffRowsHeatmap: React.FC<{ results: QueryResult[], dim0Name: string, dim1Name: string }> = React.memo(
  ({ results, dim0Name, dim1Name }) => {
    // Get both actual and planned rows by combination
    const actualRowsByCombination = getActualRowsByCombinationFromResults(results);
    const planRowsByCombination = getPlanRowsByCombinationFromResults(results);
    if (!actualRowsByCombination || !planRowsByCombination || actualRowsByCombination.size === 0 || planRowsByCombination.size === 0) return null;
    // Calculate diff (Planned - Actual)
    const diffByCombination = new Map<string, number>();
    for (const [key, actual] of actualRowsByCombination.entries()) {
      const planned = planRowsByCombination.get(key);
      if (typeof planned === 'number') {
        diffByCombination.set(key, planned - actual);
      }
    }
    if (diffByCombination.size === 0) return null;
    const keys = Array.from(diffByCombination.keys());
    const ySet = new Set<number>();
    const xSet = new Set<number>();
    keys.forEach(k => {
      const [x, y] = k.split(",").map(Number);
      xSet.add(x);
      ySet.add(y);
    });
    const xArr = Array.from(xSet).sort((a, b) => a - b);
    const yArr = Array.from(ySet);
    const baseHeight = 350;
    const extraRows = Math.max(0, yArr.length - 10);
    const height = baseHeight + extraRows * 15;
    const series = getHeatmapFromPlanFingerprint(diffByCombination);
    const allDiffs = Array.from(diffByCombination.values());
    const min = Math.min(...allDiffs);
    const max = Math.max(...allDiffs);
    const ranges = getBlueColorRanges(min, max);
    const options = getHeatmapOptions(xArr, yArr, dim0Name, dim1Name);
    const chartOptions = {
      ...options,
      title: { text: "Actual - Planned Tuples Diff Heatmap" },
      plotOptions: {
        heatmap: {
          colorScale: {
            ranges
          }
        }
      }
    };
    return (
      <div style={{ margin: "24px 0" }}>
        <ReactApexChart options={chartOptions} series={series} type="heatmap" height={height} />
      </div>
    );
  }
);
DiffRowsHeatmap.displayName = "DiffTuplesHeatmap";

// Number of plans info (always show live count from planFingerprintMap)
const PlanCountInfo: React.FC = () => (
  planFingerprintMap.size > 0 ? (
    <div className={styles.planCount}>Number of different plans: {planFingerprintMap.size}</div>
  ) : null
);

// Plan fingerprint map list
const PlanFingerprintMapList: React.FC<{ planUsageCount: Record<number, number> }> = ({ planUsageCount }) => {
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
              <strong>Query plan {id}</strong>
                <span className={styles.planUsageCount}>
                  (Used {planUsageCount[id] || 0} times)
                </span>
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

// Generic collapsible query/result list
interface CollapsibleQueryListProps {
  title: string;
  results: QueryResult[];
  boxClassName?: string;
  preClassName?: string;
  emptyText?: string;
}

const CollapsibleQueryList: React.FC<CollapsibleQueryListProps> = ({ title, results, boxClassName, preClassName, emptyText }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={boxClassName}>
      <div className={styles.sectionTitle} style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center' }} onClick={() => setOpen(v => !v)}>
        <Arrow open={open} />
        <span style={{marginLeft: 6}}>{title}</span>
      </div>
      {open && (
        <div className={styles.resultContent}>
          {results.length === 0 ? (
            <span className={styles.noResult}>{emptyText ?? 'No result'}</span>
          ) : (
            <ul className={styles.resultList}>
              {results.map((res, idx) => (
                <li key={idx} className={styles.resultItem}>
                  <pre className={preClassName} style={{ userSelect: 'text' }}>{res.query}
{res.error ? `\nError: ${res.error}` : `\nResult: ${JSON.stringify(res.result, null, 2)}`}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// Info text if no results or fingerprints are present
const NoResultInfo: React.FC = () => (
  <div className={styles.noResult} style={{ textAlign: 'center' }}>Please execute a query</div>
);

// Main ResultList component
export default function ResultList({ results = [], dim0Name, dim1Name, isExecuting }: ResultListProps) {
  // Remove hasExecuted, use !isExecuting for all logic
  const planUsageCount: Record<number, number> = {};
  planFingerprintByCombination.forEach((id: number) => {
    planUsageCount[id] = (planUsageCount[id] || 0) + 1;
  });
  const showNoResultInfo = isExecuting || planFingerprintMap.size === 0;

  return (
    <div className={styles.resultBox}>
      {!isExecuting && (
        <>
          <PlanHeatmap dim0Name={dim0Name} dim1Name={dim1Name} planFingerprintByCombination={planFingerprintByCombination} />
          <PlanCountInfo />
          <PlanFingerprintMapList planUsageCount={planUsageCount} />
          <TotalCostHeatmap results={results} dim0Name={dim0Name} dim1Name={dim1Name} />
          <ActualTotalTimeHeatmap results={results} dim0Name={dim0Name} dim1Name={dim1Name} />
          <PlanRowsHeatmap results={results} dim0Name={dim0Name} dim1Name={dim1Name} />
          <ActualRowsHeatmap results={results} dim0Name={dim0Name} dim1Name={dim1Name} />
          <DiffRowsHeatmap results={results} dim0Name={dim0Name} dim1Name={dim1Name} />
        </>
      )}
      {showNoResultInfo && <NoResultInfo />}
    </div>
  );
}

// Place PreparationSteps and SqlQueries outside the gray resultBox
interface ResultListWithDetailsProps extends ResultListProps {
  preparationResults?: QueryResult[];
}

export const ResultListWithDetails: React.FC<ResultListWithDetailsProps> = (props) => {
  const hasDetails = !props.isExecuting && ((props.results?.length ?? 0) > 0 || (props.preparationResults?.length ?? 0) > 0);
  return (
    <>
      <ResultList {...props} />
      {hasDetails && (
        <div className={styles.detailsBox}>
          <h3 className={styles.sectionTitle} style={{marginBottom: 18}}>Query Execution Details</h3>
          <CollapsibleQueryList
            title="Detailed Preparation Steps"
            results={props.preparationResults ?? []}
            boxClassName={styles.preparationBox}
            preClassName={styles.preparation}
            emptyText="No preparation steps"
          />
          <CollapsibleQueryList
            title="Detailed SQL Queries"
            results={props.results ?? []}
            boxClassName={styles.sqlBox}
            preClassName={styles.sql}
            emptyText="No result"
          />
        </div>
      )}
    </>
  );
};
