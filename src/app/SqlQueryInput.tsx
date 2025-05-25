import React, { useRef } from "react";
import styles from "./SqlQueryInput.module.css";

interface SqlQueryInputProps {
  value: string;
  onChange: (v: string) => void;
  dim1Active: boolean;
  preparationValue: string; // Value for preparation steps textarea
  onPreparationChange: (v: string) => void; // onChange for preparation steps
}

// Default preparation steps for the preparation textarea
export const DEFAULT_PREPARATION_STEPS = [
  'SET enable_seqscan = on;',
  'SET cpu_index_tuple_cost = 0.0005;',
  'DROP TABLE IF EXISTS data;',
  'CREATE TABLE data(key integer, value text);',
  'INSERT INTO data (key, value) SELECT i, i::text FROM generate_series(1, 100000) i;',
  'CREATE INDEX ON data(key);',
  'ANALYZE data;'
].join('\n');

export const DEFAULT_SQL_QUERY = "SELECT * FROM data WHERE key > %%DIMENSION0%%;";

export default function SqlQueryInput({ value, onChange, dim1Active, preparationValue, onPreparationChange }: SqlQueryInputProps) {
  // Ref for the textarea to control cursor position
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Insert placeholder at the current cursor position
  const insertPlaceholder = (placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.slice(0, start) + placeholder + value.slice(end);
    onChange(newValue);
    // Set cursor after inserted placeholder
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
    }, 0);
  };

  return (
    <div className={styles.sqlBox}>
      <label htmlFor="preparation-steps" className={styles.sqlLabel}>
        Preparation Steps
      </label>
      <textarea
        id="preparation-steps"
        value={preparationValue}
        onChange={e => onPreparationChange(e.target.value)}
        rows={7}
        className={styles.sqlTextarea}
        placeholder="Describe any preparation steps here..."
      />
      <label htmlFor="sql-query" className={styles.sqlLabel}>
        SQL Query
      </label>
      <textarea
        id="sql-query"
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className={styles.sqlTextarea}
        placeholder="Enter your SQL query here..."
      />
      <div className={styles.sqlHint}>
        You can use the placeholder{' '}
        <button
          type="button"
          className={styles.sqlPlaceholderBtn}
          onClick={() => insertPlaceholder('%%DIMENSION0%%')}
        >
          %%DIMENSION0%%
        </button>
        {dim1Active && (
          <>
            {' '}and{' '}
            <button
              type="button"
              className={styles.sqlPlaceholderBtn}
              onClick={() => insertPlaceholder('%%DIMENSION1%%')}
            >
              %%DIMENSION1%%
            </button>
          </>
        )}
        {' '}in your query.
      </div>
    </div>
  );
}
