'use strict';

const fs = require('node:fs');

function clamp01(value) {
  if (!Number.isFinite(Number(value))) return 0;
  const num = Number(value);
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

function nowMs() {
  return Date.now();
}

function normalizeMlInferenceConfig(raw = {}) {
  const budgets = raw.budgets || {};
  const featureRules = raw.featureRules || {};
  const fallback = raw.fallback || {};
  return {
    enabled: raw.enabled !== false,
    modelArtifactPath: raw.modelArtifactPath || '',
    minFeatureCount: Math.max(1, Number(raw.minFeatureCount || featureRules.minFeatureCount || 6)),
    budgets: {
      featurePreparationMs: Math.max(1, Number(budgets.featurePreparationMs || 8)),
      inferenceMs: Math.max(1, Number(budgets.inferenceMs || 12)),
    },
    fallback: {
      score: clamp01(fallback.score ?? 0.5),
      confidence: clamp01(fallback.confidence ?? 0),
      directionSupport: String(fallback.directionSupport || 'neutral'),
    },
    loggingEnabled: raw.loggingEnabled !== false,
  };
}

function normalizeContextInput(input = {}) {
  return {
    context: input.context && typeof input.context === 'object' ? input.context : {},
    sharedRuntimeBlockOutputs: input.sharedRuntimeBlockOutputs && typeof input.sharedRuntimeBlockOutputs === 'object'
      ? input.sharedRuntimeBlockOutputs
      : {},
    approvedRuleDecisionContext: input.approvedRuleDecisionContext && typeof input.approvedRuleDecisionContext === 'object'
      ? input.approvedRuleDecisionContext
      : null,
    balanceState: input.balanceState && typeof input.balanceState === 'object' ? input.balanceState : null,
    capitalRegime: input.capitalRegime || ((input.balanceState || {}).capitalRegime) || 'NORMAL',
    dataQualityState: input.dataQualityState || 'unknown',
    portfolioForecastState: input.portfolioForecastState && typeof input.portfolioForecastState === 'object'
      ? input.portfolioForecastState
      : null,
    capitalStressForecastScore: Number.isFinite(Number(input.capitalStressForecastScore))
      ? Number(input.capitalStressForecastScore)
      : null,
    forecastRegimeShiftRisk: Number.isFinite(Number(input.forecastRegimeShiftRisk))
      ? Number(input.forecastRegimeShiftRisk)
      : null,
    portfolioFragilityScore: Number.isFinite(Number(input.portfolioFragilityScore))
      ? Number(input.portfolioFragilityScore)
      : null,
  };
}

function resolveDataQualityState(input) {
  const candidates = [
    input.dataQualityState,
    (input.approvedRuleDecisionContext || {}).dataQualityState,
  ];
  const blockStates = Object.values(input.sharedRuntimeBlockOutputs || {})
    .map((x) => (x && x.dataQualityState) || 'unknown');
  const all = candidates.concat(blockStates).filter(Boolean);
  if (all.some((state) => state === 'degraded' || state === 'cached')) return 'degraded';
  if (all.some((state) => state === 'missing')) return 'missing';
  if (all.some((state) => state === 'ok')) return 'ok';
  return 'unknown';
}

function encodeCapitalRegime(capitalRegime) {
  const normalized = String(capitalRegime || 'NORMAL');
  if (normalized === 'PROHIBIT_NEW_ENTRIES' || normalized === 'HALT_NEW_ENTRIES') return -1;
  if (normalized === 'CONSERVE_CAPITAL') return -0.6;
  if (normalized === 'REDUCE_RISK') return -0.3;
  return 0.2;
}

function extractFeatureVector(normalizedInput) {
  const vector = {};
  const reasons = [];
  const sharedBlocks = normalizedInput.sharedRuntimeBlockOutputs || {};

  // Русский комментарий: используем только уже рассчитанные block outputs без повторного heavy pipeline.
  Object.keys(sharedBlocks).slice(0, 24).forEach((blockName) => {
    const block = sharedBlocks[blockName] || {};
    if (Number.isFinite(Number(block.score))) vector[`block_${blockName}_score`] = clamp01(block.score);
    if (Number.isFinite(Number(block.confidence))) vector[`block_${blockName}_confidence`] = clamp01(block.confidence);
  });

  const decision = normalizedInput.approvedRuleDecisionContext || {};
  if (Number.isFinite(Number(decision.score))) vector.rule_decision_score = clamp01(decision.score);
  if (Number.isFinite(Number(decision.confidence))) vector.rule_decision_confidence = clamp01(decision.confidence);

  vector.capital_regime_encoded = encodeCapitalRegime(normalizedInput.capitalRegime);

  const balanceState = normalizedInput.balanceState || {};
  if (Number.isFinite(Number(balanceState.drawdownPct))) vector.balance_drawdown_pct = clamp01(balanceState.drawdownPct);
  if (Number.isFinite(Number(balanceState.equityUtilizationPct))) vector.balance_equity_utilization_pct = clamp01(balanceState.equityUtilizationPct);
  if (balanceState.unloadMode === true) vector.balance_unload_mode = 1;

  if (normalizedInput.capitalStressForecastScore !== null) {
    vector.capital_stress_forecast_score = clamp01(normalizedInput.capitalStressForecastScore);
  }
  if (normalizedInput.forecastRegimeShiftRisk !== null) {
    vector.forecast_regime_shift_risk = clamp01(normalizedInput.forecastRegimeShiftRisk);
  }
  if (normalizedInput.portfolioFragilityScore !== null) {
    vector.portfolio_fragility_score = clamp01(normalizedInput.portfolioFragilityScore);
  }

  const portfolioForecast = normalizedInput.portfolioForecastState || {};
  if (Number.isFinite(Number(portfolioForecast.confidence))) {
    vector.portfolio_forecast_confidence = clamp01(portfolioForecast.confidence);
  }

  if (Object.keys(vector).length === 0) reasons.push('missing_feature_vector');
  return { vector, reasons };
}

function safeReadModelArtifact(pathToModel) {
  if (!pathToModel) {
    return { model: null, errorCode: 'model_artifact_path_not_set' };
  }

  try {
    if (!fs.existsSync(pathToModel)) return { model: null, errorCode: 'model_artifact_not_found' };
    const raw = fs.readFileSync(pathToModel, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { model: null, errorCode: 'model_artifact_invalid' };
    const weights = parsed.weights && typeof parsed.weights === 'object' ? parsed.weights : {};
    return {
      model: {
        version: parsed.version || 'unknown',
        bias: Number.isFinite(Number(parsed.bias)) ? Number(parsed.bias) : 0,
        weights,
        minFeatures: Math.max(1, Number(parsed.minFeatures || 1)),
      },
      errorCode: null,
    };
  } catch (_error) {
    return { model: null, errorCode: 'model_artifact_read_error' };
  }
}

function runModelInference(model, vector) {
  const featureNames = Object.keys(vector);
  const dot = featureNames.reduce((acc, key) => {
    const weight = Number.isFinite(Number(model.weights[key])) ? Number(model.weights[key]) : 0;
    return acc + (Number(vector[key]) * weight);
  }, Number(model.bias || 0));

  const score = 1 / (1 + Math.exp(-dot));
  const modelCoverage = featureNames.length === 0
    ? 0
    : featureNames.filter((key) => Number.isFinite(Number(model.weights[key]))).length / featureNames.length;
  const confidence = clamp01(0.2 + (clamp01(modelCoverage) * 0.8));
  return {
    mlScore: clamp01(score),
    mlConfidence: confidence,
    coverage: clamp01(modelCoverage),
  };
}

function resolveDirectionHint(score) {
  if (score >= 0.56) return { mlDirectionSupport: 'long', mlDecisionHint: 'confirm_long_candidate' };
  if (score <= 0.44) return { mlDirectionSupport: 'short', mlDecisionHint: 'confirm_short_candidate' };
  return { mlDirectionSupport: 'neutral', mlDecisionHint: 'hold_neutral' };
}

function createFallbackOutput(input, config, reasonCodes, fallbackState, metadata = {}) {
  const direction = String(config.fallback.directionSupport || 'neutral');
  return {
    mlScore: clamp01(config.fallback.score),
    mlConfidence: clamp01(config.fallback.confidence),
    mlDirectionSupport: direction,
    mlDecisionHint: direction === 'neutral' ? 'fallback_neutral' : `fallback_${direction}`,
    mlDataQualityState: resolveDataQualityState(input),
    mlReasonCodes: Array.from(new Set([...(reasonCodes || []), 'ml_phase1_fallback'])).slice(0, 32),
    mlFallbackState: fallbackState,
    metadata: {
      ...metadata,
      ownership: {
        isFinalDecisionOwner: false,
        isSizingOwner: false,
        isExecutionOwner: false,
        recalculatesMarketData: false,
        recalculatesHeavyFeatures: false,
      },
    },
  };
}

function createMlInferenceLayer(rawConfig = {}, dependencies = {}) {
  const config = normalizeMlInferenceConfig(rawConfig);
  const runtime = {
    cachedModel: null,
    cachedModelPath: null,
    cachedModelErrorCode: null,
  };

  function log(message) {
    if (!config.loggingEnabled) return;
    if (dependencies && typeof dependencies.log === 'function') {
      dependencies.log(message);
    }
  }

  function getModel() {
    const configuredPath = config.modelArtifactPath;
    if (runtime.cachedModel && runtime.cachedModelPath === configuredPath) {
      return { model: runtime.cachedModel, errorCode: null, cached: true };
    }

    const loaded = safeReadModelArtifact(configuredPath);
    runtime.cachedModel = loaded.model;
    runtime.cachedModelPath = configuredPath;
    runtime.cachedModelErrorCode = loaded.errorCode;
    return { model: loaded.model, errorCode: loaded.errorCode, cached: false };
  }

  function evaluate(input = {}, runtimeControls = {}) {
    const startedAt = nowMs();
    const normalizedInput = normalizeContextInput(input);
    const reasonCodes = ['ml_phase1_inference_layer'];
    const cycleId = ((normalizedInput.context || {}).cycleId) || 'n/a';
    const ticker = ((normalizedInput.context || {}).ticker) || 'n/a';

    if (!config.enabled) {
      reasonCodes.push('ml_phase1_disabled');
      return createFallbackOutput(normalizedInput, config, reasonCodes, 'disabled', {
        cycleId,
        ticker,
      });
    }

    const modelSnapshot = getModel();
    if (!modelSnapshot.model) {
      reasonCodes.push(modelSnapshot.errorCode || 'model_unavailable');
      log(`[mlInferenceLayer] cycle=${cycleId} ticker=${ticker} fallback=model_unavailable reason=${modelSnapshot.errorCode || 'unknown'}`);
      return createFallbackOutput(normalizedInput, config, reasonCodes, 'model_unavailable', {
        cycleId,
        ticker,
        modelErrorCode: modelSnapshot.errorCode || 'model_unavailable',
      });
    }

    const featureStartedAt = nowMs();
    const extracted = extractFeatureVector(normalizedInput);
    const featurePrepDurationMs = Math.max(0, nowMs() - featureStartedAt);
    const featureNames = Object.keys(extracted.vector);

    if (featurePrepDurationMs > config.budgets.featurePreparationMs) {
      reasonCodes.push('feature_prep_budget_exceeded');
      return createFallbackOutput(normalizedInput, config, reasonCodes, 'budget_degraded', {
        cycleId,
        ticker,
        featurePrepDurationMs,
        budgetMs: config.budgets.featurePreparationMs,
      });
    }

    const minRequired = Math.max(config.minFeatureCount, Number(modelSnapshot.model.minFeatures || 1));
    if (featureNames.length < minRequired) {
      reasonCodes.push('missing_feature_subset');
      reasonCodes.push(...extracted.reasons);
      log(`[mlInferenceLayer] cycle=${cycleId} ticker=${ticker} fallback=missing_feature available=${featureNames.length} required=${minRequired}`);
      return createFallbackOutput(normalizedInput, config, reasonCodes, 'missing_feature_fallback', {
        cycleId,
        ticker,
        availableFeatures: featureNames.length,
        requiredFeatures: minRequired,
      });
    }

    const inferenceStartedAt = nowMs();
    const modelOutput = runModelInference(modelSnapshot.model, extracted.vector);
    const inferenceDurationMs = Math.max(0, nowMs() - inferenceStartedAt);
    if (inferenceDurationMs > config.budgets.inferenceMs) {
      reasonCodes.push('inference_budget_exceeded');
      return createFallbackOutput(normalizedInput, config, reasonCodes, 'budget_degraded', {
        cycleId,
        ticker,
        inferenceDurationMs,
        budgetMs: config.budgets.inferenceMs,
      });
    }

    const direction = resolveDirectionHint(modelOutput.mlScore);
    const totalDurationMs = Math.max(0, nowMs() - startedAt);
    const output = {
      mlScore: modelOutput.mlScore,
      mlConfidence: modelOutput.mlConfidence,
      mlDirectionSupport: direction.mlDirectionSupport,
      mlDecisionHint: direction.mlDecisionHint,
      mlDataQualityState: resolveDataQualityState(normalizedInput),
      mlReasonCodes: Array.from(new Set([
        ...reasonCodes,
        ...extracted.reasons,
        'ml_phase1_advisory_only',
      ])).slice(0, 32),
      mlFallbackState: 'none',
      metadata: {
        modelVersion: modelSnapshot.model.version || 'unknown',
        featureCount: featureNames.length,
        featurePrepDurationMs,
        inferenceDurationMs,
        totalDurationMs,
        cycleId,
        ticker,
        ownership: {
          isFinalDecisionOwner: false,
          isSizingOwner: false,
          isExecutionOwner: false,
          recalculatesMarketData: false,
          recalculatesHeavyFeatures: false,
        },
        runtimeLayer: {
          layerName: 'mlInference',
          advisoryOnly: true,
          degraded: false,
        },
      },
    };

    if (runtimeControls && typeof runtimeControls.registerLayerExecution === 'function') {
      runtimeControls.registerLayerExecution('mlInference', totalDurationMs, 'full');
    }

    log(`[mlInferenceLayer] cycle=${cycleId} ticker=${ticker} score=${output.mlScore} confidence=${output.mlConfidence} direction=${output.mlDirectionSupport} fallback=${output.mlFallbackState}`);
    return output;
  }

  return {
    evaluate,
    getStatus() {
      return {
        enabled: config.enabled,
        modelArtifactPath: config.modelArtifactPath,
        hasCachedModel: !!runtime.cachedModel,
        modelLoadErrorCode: runtime.cachedModelErrorCode,
      };
    },
    normalizeInput: normalizeContextInput,
    normalizeConfig: normalizeMlInferenceConfig,
  };
}

module.exports = {
  createMlInferenceLayer,
  normalizeMlInferenceConfig,
  normalizeMlInferenceInput: normalizeContextInput,
};
