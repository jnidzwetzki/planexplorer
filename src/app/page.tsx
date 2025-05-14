"use client";

import React, { useState } from "react";
import IntervalSelector from "./IntervalSelector";
import SqlQueryInput, { DEFAULT_PREPARATION_STEPS, DEFAULT_SQL_QUERY } from "./SqlQueryInput";
import ResultList from "./ResultList";
import styles from './page.module.css';
import { handleExecuteLogic, getPlanCount, clearPlanFingerprints } from "./handleExecuteLogic";

export default function Home() {
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
  const [sqlQuery, setSqlQuery] = useState(DEFAULT_SQL_QUERY);
  const [step0, setStep0] = useState(2500);
  const [step1, setStep1] = useState(1);
  const [preparationValue, setPreparationValue] = useState(DEFAULT_PREPARATION_STEPS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [planCount, setPlanCount] = useState(0);
  const [planFingerprintByCombination, setPlanFingerprintByCombination] = useState<Record<string, number>>({});
  // Description fields for both dimensions
  const DEFAULT_DESCRIPTION_0 = "Dimension 0";
  const DEFAULT_DESCRIPTION_1 = "Dimension 1";
  const [description0, setDescription0] = useState(DEFAULT_DESCRIPTION_0);
  const [description1, setDescription1] = useState(DEFAULT_DESCRIPTION_1);

  async function handleExecute() {
    setIsExecuting(true);
    setPlanFingerprintByCombination({}); // Clear heatmap before execution
    clearPlanFingerprints(); // Clear fingerprints and counter before execution
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
    });
    setPreparationResults(res.preparationResults);
    setResults(res.sqlResults);
    setPlanCount(getPlanCount());
    setPlanFingerprintByCombination(res.planFingerprintByCombination);
    setIsExecuting(false);
  }

  // Reset/Clear handlers: set descriptions back to default
  const handleReset = () => {
    setResults([]);
    setPreparationResults([]);
    setPreparationValue(DEFAULT_PREPARATION_STEPS);
    setSqlQuery(DEFAULT_SQL_QUERY);
    setDim1Active(false); // Hide Dimension 1 interval on reset
    setPlanFingerprintByCombination({}); // Clear heatmap
    clearPlanFingerprints(); // Clear fingerprints and counter on reset
    setDescription0(DEFAULT_DESCRIPTION_0);
    setDescription1(DEFAULT_DESCRIPTION_1);
  };
  const handleClear = () => {
    setResults([]);
    setPreparationResults([]);
    setPreparationValue("");
    setSqlQuery("");
    setPlanFingerprintByCombination({}); // Clear heatmap
    clearPlanFingerprints(); // Clear fingerprints and counter on clear
    setDescription0(DEFAULT_DESCRIPTION_0);
    setDescription1(DEFAULT_DESCRIPTION_1);
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>PostgreSQL Query Plan Explorer</h1>
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
        <div>
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
          />
          <button onClick={() => setDim1Active(false)} className={styles.buttonRemove}>
            – Remove Dimension 1
          </button>
        </div>
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
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
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
          onClick={handleReset}
          className={styles.buttonReset}
        >
          Reset
        </button>
        <button
          onClick={handleClear}
          className={styles.buttonClear}
        >
          Clear
        </button>
      </div>
      <ResultList
        results={results}
        preparationResults={preparationResults}
        planCount={planCount}
        planFingerprintByCombination={planFingerprintByCombination}
        dim0Name={description0}
        dim1Name={description1}
      />
    </div>
  );
}
