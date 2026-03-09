import * as path from "path";

let ROOT = path.resolve(__dirname, "..");
let SRC_DIR = path.join(ROOT, "src");
let CLIENT_LIB_DIR = path.join(ROOT, "client-lib");
let CLIENT_LIB_SRC = path.join(CLIENT_LIB_DIR, "src");

function configureRoot(root?: string, clientLibName?: string) {
  if (root) ROOT = path.resolve(root);
  SRC_DIR = path.join(ROOT, "src");
  const clientName = clientLibName || "client-sdk";
  CLIENT_LIB_DIR = path.join(ROOT, clientName);
  CLIENT_LIB_SRC = path.join(CLIENT_LIB_DIR, "src");
}

export { ROOT, SRC_DIR, CLIENT_LIB_DIR, CLIENT_LIB_SRC, configureRoot };
