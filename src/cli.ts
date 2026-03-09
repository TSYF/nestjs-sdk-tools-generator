#!/usr/bin/env node
import { main } from "./index";

async function run() {
  const projectRoot = process.argv[2] || process.cwd();
  const clientDirName = process.argv[3] || "client-sdk";
  try {
    await Promise.resolve(main(projectRoot, clientDirName));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
