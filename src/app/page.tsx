"use client";

import React, { useState } from "react";
import IntervalSelector from "./IntervalSelector";
import SqlQueryInput, { DEFAULT_PREPARATION_STEPS, DEFAULT_SQL_QUERY } from "./SqlQueryInput";
import ResultList from "./ResultList";
import styles from './page.module.css';
import { handleExecuteLogic, clearPlanFingerprints } from "./handleExecuteLogic";
import DatabaseSelector, { DatabaseBackend } from "./DatabaseSelector";

export default function Home() {
  // Always use pglite as default backend, even in dev:full mode
  const isDevFull = typeof window !== 'undefined' && process.env.NEXT_PUBLIC_DEVFULL === '1';
  const [backend, setBackend] = useState<DatabaseBackend>("pglite");
  const [dim1Active, setDim1Active] = useState(false);
  const [start0, setStart0] = useState(0);
  const [end0, setEnd0] = useState(50000);
  const [start1, setStart1] = useState(0);
  const [end1, setEnd1] = useState(10);
  const [results, setResults] = useState<string[]>([]);
  const [preparationResults, setPreparationResults] = useState<string[]>([]);
  const [start0Valid, setStart0Valid] = useState(true);
  const [end0Valid, setEnd0Valid] = useState(true);
  const [start1Valid, setStart1Valid] = useState(true);
  const [end1Valid, setEnd1Valid] = useState(true);
  const [sqlQuery, setSqlQuery] = useState(""); // Start with empty SQL query
  const [step0, setStep0] = useState(1000); // Default step for Dimension 0 set to 1000
  const [step1, setStep1] = useState(1);
  const [preparationValue, setPreparationValue] = useState(""); // Start with empty preparation steps
  const [isExecuting, setIsExecuting] = useState(false);
  const [planFingerprintByCombination, setPlanFingerprintByCombination] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  // Description fields for both dimensions
  const DEFAULT_DESCRIPTION_0 = "Dimension 0";
  const DEFAULT_DESCRIPTION_1 = "Dimension 1";
  const [description0, setDescription0] = useState(DEFAULT_DESCRIPTION_0);
  const [description1, setDescription1] = useState(DEFAULT_DESCRIPTION_1);
  const [sampled, setSampled] = useState<boolean>(false);
  const [sampleCount, setSampleCount] = useState<number | undefined>(undefined);
  const [totalExecutions, setTotalExecutions] = useState<number | undefined>(undefined);
  const [proxyUrl, setProxyUrl] = useState<string>("http://localhost:4000");

  async function handleExecute() {
    setIsExecuting(true);
    setProgress(null); // Progress will be set by onProgress callback from handleExecuteLogic
    setPlanFingerprintByCombination({}); // Clear heatmap before execution
    clearPlanFingerprints(); // Clear fingerprints and counter before execution
    setError(undefined); // Clear previous error
    const res = await handleExecuteLogic({
      dim1Active,
      start0,
      end0,
      step0,
      start1,
      end1,
      step1,
      sqlQuery,
      preparation: preparationValue,
      backend,
      proxyUrl,
      onProgress: (current, total) => setProgress({ current, total }),
    });
    setPreparationResults(res.preparationResults);
    setResults(res.sqlResults);
    setPlanFingerprintByCombination(res.planFingerprintByCombination);
    setError(res.error); // Set error if present
    setSampled(res.sampled ?? false);
    setSampleCount(res.sampleCount);
    setTotalExecutions(res.totalExecutions);
    setIsExecuting(false);
    setProgress(null);
  }

  // Handler to load demo query 1: first clear, then set demo query values
  const handleLoadDemoQuery1 = () => {
    handleClear();
    setPreparationValue(DEFAULT_PREPARATION_STEPS);
    setSqlQuery(DEFAULT_SQL_QUERY);
    setStep0(1000); // Set default step for Dimension 0
    setDescription0('WHERE key > X');
    setDescription1(DEFAULT_DESCRIPTION_1);
  };

  // Handler to load demo query 2: clear, set demo values, open dimension 1, set range and step, set SQL with SET
  const handleLoadDemoQuery2 = () => {
    handleClear();
    setPreparationValue(DEFAULT_PREPARATION_STEPS);
    setDim1Active(true);
    setStart1(0);
    setEnd1(8);
    setStep1(0.25);
    setStep0(1000); // Set default step for Dimension 0
    setSqlQuery("SET random_page_cost = %%DIMENSION1%%;\n" + DEFAULT_SQL_QUERY);
    setDescription0('WHERE key > X');
    setDescription1('random_page_cost');
  };

  // Handler to load demo query 3: like demo 2, but with different SQL query
  const handleLoadDemoQuery3 = () => {
    handleClear();
    setPreparationValue(DEFAULT_PREPARATION_STEPS);
    setDim1Active(true);
    setStart1(0);
    setEnd1(8);
    setStep1(0.25);
    setStep0(1000); // Set default step for Dimension 0
    setSqlQuery("SET random_page_cost = %%DIMENSION1%%;\nSELECT * FROM data d1 LEFT JOIN data d2 ON (d1.key = d2.key) WHERE d1.key > %%DIMENSION0%%;");
    setDescription0('WHERE key > X');
    setDescription1('random_page_cost');
  };

  const handleClear = () => {
    setResults([]);
    setPreparationResults([]);
    setPreparationValue("");
    setSqlQuery("");
    setPlanFingerprintByCombination({}); // Clear heatmap
    clearPlanFingerprints(); // Clear fingerprints and counter on clear
    setDim1Active(false); // Close Dimension 1 on clear
    setStart0(0); // Reset Dimension 0 start
    setEnd0(50000); // Reset Dimension 0 end
    setStep0(1000); // Reset Dimension 0 step
    setDescription0(DEFAULT_DESCRIPTION_0); // Reset Dimension 0 description
    setStart1(0); // Reset Dimension 1 start
    setEnd1(10); // Reset Dimension 1 end
    setStep1(1); // Reset Dimension 1 step
    setDescription1(DEFAULT_DESCRIPTION_1); // Reset Dimension 1 description
    setError(undefined); // Clear error on clear
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Query Plan Explorer</h1>
      {isDevFull && (
        <DatabaseSelector
          value={backend}
          onChange={setBackend}
          proxyUrl={proxyUrl}
          onProxyUrlChange={setProxyUrl}
        />
      )}
      <IntervalSelector
        label="Dimension 0"
        start={start0}
        end={end0}
        setStart={setStart0}
        setEnd={setEnd0}
        startValid={start0Valid}
        setStartValid={setStart0Valid}
        endValid={end0Valid}
        setEndValid={setEnd0Valid}
        step={step0}
        setStep={setStep0}
        description={description0}
        setDescription={setDescription0}
      />
      {dim1Active ? (
        <IntervalSelector
          label="Dimension 1"
          start={start1}
          end={end1}
          setStart={setStart1}
          setEnd={setEnd1}
          startValid={start1Valid}
          setStartValid={setStart1Valid}
          endValid={end1Valid}
          setEndValid={setEnd1Valid}
          step={step1}
          setStep={setStep1}
          description={description1}
          setDescription={setDescription1}
          onRemove={() => setDim1Active(false)}
        />
      ) : (
        <button onClick={() => setDim1Active(true)} className={styles.buttonAdd}>
          + Add Dimension 1
        </button>
      )}
      <div style={{ marginBottom: 24 }}>
        <SqlQueryInput
          value={sqlQuery}
          onChange={setSqlQuery}
          dim1Active={dim1Active}
          preparationValue={preparationValue}
          onPreparationChange={setPreparationValue}
        />
      </div>
      <div className={styles.buttonRow}>
        <div className={styles.demoButtonGroup}>
          <button
            onClick={handleLoadDemoQuery1}
            className={styles.buttonDemo}
            title="Load Demo Query 1"
          >
            Query 1
          </button>
          <button
            onClick={handleLoadDemoQuery2}
            className={styles.buttonDemo}
            title="Load Demo Query 2"
          >
            Query 2
          </button>
          <button
            onClick={handleLoadDemoQuery3}
            className={styles.buttonDemo}
            title="Load Demo Query 3"
          >
            Query 3
          </button>
        </div>
        <div className={styles.actionButtonGroup}>
          <button onClick={handleExecute} className={styles.buttonPrimary}
            disabled={
              isExecuting ||
              !start0Valid || !end0Valid || (dim1Active && (!start1Valid || !end1Valid)) || sqlQuery.trim() === ""
            }
          >
            {isExecuting ? (
              <span className={styles.spinner} aria-label="Loading" />
            ) : (
              "Execute"
            )}
          </button>
          <button
            onClick={handleClear}
            className={styles.buttonClear}
          >
            Clear
          </button>
        </div>
      </div>
      {error && (
        <div style={{ color: '#dc2626', background: '#fff0f0', border: '1.5px solid #ef4444', borderRadius: 8, padding: '12px 18px', marginBottom: 18, fontWeight: 600 }}>
          Error: {error}
        </div>
      )}
      {isExecuting && progress && (
        <div style={{ margin: "1em 0" }}>
          <progress value={progress.current} max={progress.total} style={{ width: "100%" }} />
          <div style={{ textAlign: "center", fontSize: "0.9em" }}>
            Query {progress.current} of {progress.total}
          </div>
        </div>
      )}
      <ResultList
        results={results}
        preparationResults={preparationResults}
        planFingerprintByCombination={planFingerprintByCombination}
        dim0Name={description0}
        dim1Name={description1}
        sampled={sampled}
        sampleCount={sampleCount}
        totalExecutions={totalExecutions}
      />
    </div>
  );
}
