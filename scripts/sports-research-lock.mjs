import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

export async function withResearchLock(root, action) {
  await mkdir(root, { recursive: true });
  const windows = process.platform === "win32";
  if (!windows && process.platform !== "linux") throw new Error("Сбор поддерживается на Windows и Linux");
  const store = await realpath(root);
  const key = createHash("sha256").update(windows ? store.toLowerCase() : store).digest("hex");
  const address = windows ? "\\\\.\\pipe\\sports-research-" + key : "\0sports-research-" + key;
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, resolve);
  }).catch((error) => {
    if (error.code === "EADDRINUSE") throw new Error("Исследовательский прогон уже выполняется", { cause: error });
    throw error;
  });
  try {
    const legacy = join(store, "collect.lock");
    const body = await readFile(legacy, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (body !== null) {
      const { pid } = JSON.parse(body);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("Нельзя проверить старую блокировку");
      try {
        process.kill(pid, 0);
        throw new Error("Процесс со старой блокировкой ещё работает");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      await unlink(legacy);
    }
    return await action();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
