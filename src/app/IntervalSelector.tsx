import React from "react";
import styles from './IntervalSelector.module.css';

interface IntervalSelectorProps {
  label: string;
  start: number;
  end: number;
  setStart: (v: number) => void;
  setEnd: (v: number) => void;
  startValid: boolean;
  setStartValid: (v: boolean) => void;
  endValid: boolean;
  setEndValid: (v: boolean) => void;
  step: number;
  setStep: (v: number) => void;
  description: string;
  setDescription: (v: string) => void;
}

export default function IntervalSelector({ label, start, end, setStart, setEnd, startValid, setStartValid, endValid, setEndValid, step, setStep, description, setDescription }: IntervalSelectorProps) {
  const [startInput, setStartInput] = React.useState(start.toString());
  const [endInput, setEndInput] = React.useState(end.toString());
  const [stepInput, setStepInput] = React.useState(step.toString());
  const [stepValid, setStepValid] = React.useState(true);
  const [descriptionInput, setDescriptionInput] = React.useState(description);

  React.useEffect(() => {
    setStartInput(start.toString());
  }, [start]);
  React.useEffect(() => {
    setEndInput(end.toString());
  }, [end]);
  React.useEffect(() => {
    setStepInput(step.toString());
  }, [step]);
  React.useEffect(() => {
    setDescriptionInput(description);
  }, [description]);

  const isValidNumber = (val: string) => {
    if (val === "" || val === "-") return false;
    return /^-?\d+$/.test(val);
  };

  // Only allow positive integers for step
  const isValidStep = (val: string) => {
    if (val === "") return false;
    // Accept numbers like 0.3, 1, 2.5, but not 0 or negative
    return /^\d*\.?\d+$/.test(val) && Number(val) > 0;
  };

  // Check if end is less than or equal to start
  const isIntervalValid = (startVal: string, endVal: string) => {
    if (!isValidNumber(startVal) || !isValidNumber(endVal)) return true; // Only check if both are valid numbers
    return Number(endVal) > Number(startVal);
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStartInput(val);
    const valid = isValidNumber(val);
    setStartValid(valid);
    // Also check interval validity if end is valid
    if (valid && isValidNumber(endInput)) {
      setEndValid(isValidNumber(endInput) && isIntervalValid(val, endInput));
    }
    if (valid) setStart(Number(val));
  };
  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndInput(val);
    const valid = isValidNumber(val) && isIntervalValid(startInput, val);
    setEndValid(valid);
    if (isValidNumber(startInput)) {
      setStartValid(isValidNumber(startInput));
    }
    if (valid) setEnd(Number(val));
  };

  const handleStepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStepInput(val);
    const valid = isValidStep(val);
    setStepValid(valid);
    if (valid) setStep(Number(val));
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDescriptionInput(val);
    setDescription(val);
  };

  return (
    <div className={styles.intervalRow}>
      <label className={styles.inputLabel}>
        <span>{label} Start:</span>
        <input
          type="text"
          inputMode="numeric"
          value={startInput}
          onChange={handleStartChange}
          className={startValid ? styles.inputField : `${styles.inputField} ${styles.inputFieldInvalid}`}
        />
      </label>
      <label className={styles.inputLabel}>
        <span>End:</span>
        <input
          type="text"
          inputMode="numeric"
          value={endInput}
          onChange={handleEndChange}
          className={endValid ? styles.inputField : `${styles.inputField} ${styles.inputFieldInvalid}`}
        />
      </label>
      <label className={styles.inputLabel}>
        <span>Step:</span>
        <input
          type="text"
          inputMode="numeric"
          value={stepInput}
          onChange={handleStepChange}
          className={stepValid ? styles.inputField : `${styles.inputField} ${styles.inputFieldInvalid}`}
          min={1}
        />
      </label>
      <label className={styles.inputLabel} style={{ marginLeft: 8 }}>
        <span>Description:</span>
        <input
          type="text"
          value={descriptionInput}
          onChange={handleDescriptionChange}
          className={styles.inputField}
        />
      </label>
    </div>
  );
}
