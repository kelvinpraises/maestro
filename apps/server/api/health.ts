// Vercel route: GET /api/health -> liveness + family count.
// Thin delegator to the shared serverless adapter (see src/serverless.ts).
import { serve } from "../src/serverless.js";
export default serve;
