// DatabaseSelector.tsx
// Reusable selector for choosing between built-in (PGLite) and server proxy
import React, { useState } from "react";
import styles from "./DatabaseSelector.module.css";

export type DatabaseBackend = "pglite" | "proxy" | "mysql";

interface DatabaseSelectorProps {
  value: DatabaseBackend;
  onChange: (v: DatabaseBackend) => void;
  proxyUrl?: string;
  onProxyUrlChange?: (url: string) => void;
}

const DatabaseSelector: React.FC<DatabaseSelectorProps> = ({ value, onChange, proxyUrl, onProxyUrlChange }) => {
  const [testStatus, setTestStatus] = useState<null | 'success' | 'error' | 'loading'>(null);
  const [testMessage, setTestMessage] = useState<string>("");

  async function handleTestConnection() {
    if (!proxyUrl) return;
    setTestStatus('loading');
    setTestMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      // Always specify backend param for both variants
      let backendParam = '';
      if (value === 'mysql') backendParam = '?backend=mysql';
      else if (value === 'proxy') backendParam = '?backend=proxy';
      const resp = await fetch(`${proxyUrl.replace(/\/$/, '')}/ping${backendParam}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data: { ok: boolean; error?: string } = await resp.json();
        if (data.ok) {
          setTestStatus('success');
          setTestMessage('Connection successful!');
        } else {
          setTestStatus('error');
          setTestMessage(data.error ? `Server error: ${data.error}` : 'Unknown error');
        }
      } else {
        setTestStatus('error');
        let errorMsg = `HTTP error: ${resp.status}`;
        try {
          const data = await resp.json();
          if (data && data.error) {
            errorMsg = `Server error: ${data.error}`;
          }
        } catch {
          // If JSON parsing fails, keep the original error message
        }
        setTestMessage(errorMsg);
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setTestStatus('error');
        setTestMessage('Connection timed out (5s)');
      } else if (err instanceof Error) {
        setTestStatus('error');
        setTestMessage(err.message);
      } else {
        setTestStatus('error');
        setTestMessage(String(err));
      }
    }
  }

  return (
    <fieldset className={styles.selectorBox}>
      <legend className={styles.dimensionLegend} style={{marginBottom: 0}}>
        Database Backend
      </legend>
      <div className={styles.selectorRow}>
        <div className={styles.selectorRowInner}>
          <select
            id="db-backend-select"
            className={styles.selectorSelect}
            value={value}
            onChange={e => onChange(e.target.value as DatabaseBackend)}
          >
            <option value="pglite">Built-in (PGLite, in-browser)</option>
            <option value="proxy">Server Proxy (PostgreSQL, proxy backend)</option>
            <option value="mysql">Server Proxy (MySQL, proxy backend)</option>
          </select>
        </div>
        {(value === "proxy" || value === "mysql") && onProxyUrlChange && (
          <>
            <input
              type="text"
              className={styles.inputProxyUrl}
              placeholder="Proxy URL (e.g. http://localhost:4000)"
              value={proxyUrl || ""}
              onChange={e => onProxyUrlChange(e.target.value)}
            />
            <div className={styles.buttonTestRow}>
              <button
                type="button"
                className={styles.buttonTest}
                onClick={handleTestConnection}
                disabled={!proxyUrl || testStatus === 'loading'}
              >
                {testStatus === 'loading' ? 'Testing...' : 'Test Connection'}
              </button>
              {testStatus && (
                <div
                  className={
                    styles.testStatusBox +
                    (testStatus === 'success'
                      ? ' ' + styles.testStatusSuccess
                      : testStatus === 'error'
                      ? ' ' + styles.testStatusError
                      : '')
                  }
                >
                  {testMessage}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
};

export default DatabaseSelector;
