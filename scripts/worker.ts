/* Background worker: runs all sweeps every minute.
   Start with: npm run jobs  (alongside `npm run dev` / `npm start`) */
import { runSweeps } from "../src/lib/jobs";

const INTERVAL_MS = 60_000;

async function loop() {
  for (;;) {
    try {
      const result = await runSweeps();
      const total = Object.values(result).reduce((a, b) => a + b, 0);
      if (total > 0) console.log(new Date().toISOString(), result);
    } catch (e) {
      console.error("sweep failed:", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

console.log("Consent worker started — sweeping every 60s (SLA, expiry, takedowns, renewals).");
loop();
