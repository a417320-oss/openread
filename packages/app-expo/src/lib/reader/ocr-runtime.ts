import { readStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";

let installing: Promise<string> | undefined;

async function installRuntime(): Promise<string> {
  const asset = Asset.fromModule(require("../../../assets/ocr-runtime.bin"));
  await asset.downloadAsync();
  if (!asset.localUri || !asset.hash || !/^[a-f\d]+$/i.test(asset.hash)) {
    throw new Error("Offline OCR assets could not be loaded");
  }

  const relativeRoot = `openread-ocr/${asset.hash}`;
  const root = new Directory(Paths.document, relativeRoot);
  const marker = new File(root, "ready");
  if (!marker.exists || !new File(root, "index.html").exists) {
    root.create({ idempotent: true, intermediates: true });
    const bytes = await new File(asset.localUri).bytes();
    for (const { name, data } of readStoreOnlyZip(bytes)) {
      const parts = name.split("/");
      if (!parts.every(part => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) {
        throw new Error("Invalid OCR asset path");
      }
      const filename = parts.pop()!;
      const directory = parts.length ? new Directory(root, ...parts) : root;
      directory.create({ idempotent: true, intermediates: true });
      new File(directory, filename).write(data);
    }
    marker.write("1");
  }
  return relativeRoot;
}

export function prepareOcrRuntime(): Promise<string> {
  installing ??= installRuntime().finally(() => { installing = undefined; });
  return installing;
}
