export async function runPasses(passes, { logger = console } = {}) {
  const results = [];
  for (const pass of passes) {
    const startedAt = Date.now();
    try {
      const result = await pass.run();
      results.push({ name: pass.name, status: "ok", result });
      logger.log(`[${pass.name}] 완료 (${Date.now() - startedAt}ms)`, result);
    } catch (error) {
      results.push({
        name: pass.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(`[${pass.name}] 실패 (${Date.now() - startedAt}ms):`, error instanceof Error ? error.message : error);
    }
  }
  return results;
}
