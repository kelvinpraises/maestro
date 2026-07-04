// Vercel route: GET/PUT /api/board/:id -> the versioned family blob.
// The [id] segment is captured by Vercel's router, but the shared `handle` re-parses
// req.url itself, so this file only needs to delegate. Thin delegator to the shared
// serverless adapter (see src/serverless.ts).
import { serve } from "../../src/serverless.js";
export default serve;
