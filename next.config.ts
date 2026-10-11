import type { NextConfig } from "next";
import { execSync } from "child_process";

function getCommitSha(): string {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  output: 'export',
  // Set basePath and assetPrefix for GitHub Pages if needed
  basePath: '/planexplorer',
  assetPrefix: '/planexplorer/',
  agentRules: false,
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_COMMIT_SHA: getCommitSha(),
  },
};

export default nextConfig;
