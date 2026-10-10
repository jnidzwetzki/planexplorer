import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: ["node_modules", ".next", "out", "public", "dist", "build", "coverage", ".turbo", "*.log"],
  },
  ...nextCoreWebVitals,
];

export default eslintConfig;
