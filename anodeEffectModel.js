const MOLTEN_SALT_PROPERTIES = {
  CRYOLITE_MELT_TEMP: 1010,
  NORMAL_OPERATION_TEMP: 960,
  VISCOSITY_BASE: 0.0025,
  SURFACE_TENSION: 0.085,
  DENSITY: 2100,
  CO2_BUBBLE_DENSITY: 1.5,
  GAS_CONSTANT: 8.314
};

const ANODE_PROPERTIES = {
  CARBON_DENSITY: 1800,
  MOLAR_MASS_C: 0.012,
  FARADAY: 96485,
  STOICHIOMETRIC_FACTOR: 4
};

const MULTIPHYSICS_CONSTANTS = {
  BASE_VOLTAGE: 4.2,
  RESISTIVITY_BASE: 0.4,
  INITIAL_INTERPOLAR_DISTANCE: 0.045,
  MAX_BUBBLE_COVERAGE: 0.95,
  ANODE_EFFECT_VOLTAGE_BASE: 25,
  ARC_VOLTAGE_FACTOR: 80,
  CRITICAL_CURRENT_DENSITY_BASE: 1.3,
  ALUMINA_SATURATION: 8.0,
  ANODE_CONSUMPTION_RATE_BASE: 0.0001,
  ANODE_HEIGHT_INITIAL: 0.6,
  ANODE_HEIGHT_MIN: 0.1,
  BUBBLE_NUCLEATION_RATE: 120,
  BUBBLE_GROWTH_COEFF: 1.5e-4,
  BUBBLE_DETACH_DIAMETER: 0.012,
  FEEDBACK_ITERATIONS: 5,
  NORMAL_MOLE_RATIO: 2.7
};

class MultiphysicsState {
  constructor(options = {}) {
    this.appliedCurrentDensity = options.appliedCurrentDensity || 0.8;
    this.aluminaConcentration = options.aluminaConcentration || 5.0;
    this.moleRatio = options.moleRatio || MULTIPHYSICS_CONSTANTS.NORMAL_MOLE_RATIO;
    this.caF2Content = options.caF2Content || 5.0;
    this.temperature = options.temperature || MOLTEN_SALT_PROPERTIES.NORMAL_OPERATION_TEMP;
    this.timeFactor = options.timeFactor || 0;
    this.elapsedTimeHours = options.elapsedTimeHours || 0;
    this.anodeHeight = options.anodeHeight || MULTIPHYSICS_CONSTANTS.ANODE_HEIGHT_INITIAL;
    
    this.localCurrentDensity = this.appliedCurrentDensity;
    this.bubbleCoverage = 0.1;
    this.bubbleDiameter = 0.008;
    this.bubbleVelocity = 0.1;
    this.interpolarDistance = MULTIPHYSICS_CONSTANTS.INITIAL_INTERPOLAR_DISTANCE;
    this.effectiveResistivity = MULTIPHYSICS_CONSTANTS.RESISTIVITY_BASE;
    this.massTransferCoeff = 1.2e-5;
    this.anodeConsumption = 0;
    this.criticalCurrentDensity = 1.0;
    this.isAnodeEffect = false;
    this.isAnodeEffectImminent = false;
    this.arcIntensity = 0;
    this.cellVoltage = 4.2;
  }

  clone() {
    const cloned = new MultiphysicsState();
    Object.assign(cloned, this);
    return cloned;
  }
}

class MoltenSaltThermodynamics {
  static calculateViscosity(aluminaConcentration, temperature, moleRatio = 2.7) {
    const tempFactor = Math.exp(3500 / (temperature + 273));
    const aluminaFactor = 1 + 0.08 * aluminaConcentration;
    const crFactor = 1 + 0.05 * Math.abs(moleRatio - 2.7);
    return MOLTEN_SALT_PROPERTIES.VISCOSITY_BASE * tempFactor * aluminaFactor * crFactor;
  }

  static calculateResistivity(aluminaConcentration, temperature, moleRatio = 2.7, caF2 = 5.0) {
    const tempFactor = Math.exp(2000 / (temperature + 273));
    const aluminaFactor = 1 + 0.04 * aluminaConcentration;
    const crFactor = 1 + 0.03 * (moleRatio - 2.7);
    const caf2Factor = 1 + 0.015 * caF2;
    return MULTIPHYSICS_CONSTANTS.RESISTIVITY_BASE * tempFactor * aluminaFactor * crFactor * caf2Factor;
  }

  static calculateSurfaceTension(aluminaConcentration, temperature) {
    const tempFactor = 1 - 0.0003 * (temperature - 960);
    const aluminaFactor = 1 - 0.01 * aluminaConcentration;
    return MOLTEN_SALT_PROPERTIES.SURFACE_TENSION * tempFactor * aluminaFactor;
  }

  static calculateMassTransferCoeff(currentDensity, aluminaConcentration, viscosity) {
    const schmidtNumber = viscosity / (2.0e-9);
    const velocity = 0.05 * Math.sqrt(currentDensity);
    const reynolds = 0.01 * velocity * MOLTEN_SALT_PROPERTIES.DENSITY / viscosity;
    const sherwood = 0.03 * Math.pow(reynolds, 0.7) * Math.pow(schmidtNumber, 0.33);
    return sherwood * 2.0e-9 / 0.01;
  }
}

class BubbleDynamics {
  static calculateNucleationRate(localCurrentDensity, supersaturationRatio, surfaceTension) {
    const jFactor = Math.pow(localCurrentDensity, 1.2);
    const nucleationEnergy = 16 * Math.PI * Math.pow(surfaceTension, 3) / (3 * 8.314 * 1233 * Math.log(supersaturationRatio + 1));
    const energyFactor = Math.exp(-nucleationEnergy / 1000);
    return MULTIPHYSICS_CONSTANTS.BUBBLE_NUCLEATION_RATE * jFactor * energyFactor;
  }

  static calculateBubbleGrowthRate(localCurrentDensity, pressure, viscosity) {
    const gasGenerationRate = localCurrentDensity / (4 * 96485) * 22.4;
    const viscosityFactor = 1 / (1 + 20 * viscosity);
    return MULTIPHYSICS_CONSTANTS.BUBBLE_GROWTH_COEFF * gasGenerationRate * viscosityFactor;
  }

  static calculateDetachmentDiameter(surfaceTension, contactAngle) {
    const gravity = 9.81;
    const densityDiff = MOLTEN_SALT_PROPERTIES.DENSITY - MOLTEN_SALT_PROPERTIES.CO2_BUBBLE_DENSITY;
    const capillaryForce = 2 * surfaceTension * Math.sin(contactAngle) / gravity;
    return Math.min(MULTIPHYSICS_CONSTANTS.BUBBLE_DETACH_DIAMETER, 0.02 * Math.sqrt(capillaryForce / densityDiff));
  }

  static calculateRiseVelocity(bubbleDiameter, viscosity) {
    const gravity = 9.81;
    const densityDiff = MOLTEN_SALT_PROPERTIES.DENSITY - MOLTEN_SALT_PROPERTIES.CO2_BUBBLE_DENSITY;
    const reynolds = bubbleDiameter * 0.1 * MOLTEN_SALT_PROPERTIES.DENSITY / viscosity;
    
    if (reynolds < 1) {
      return (gravity * densityDiff * bubbleDiameter * bubbleDiameter) / (18 * viscosity);
    } else {
      return Math.sqrt(gravity * densityDiff * bubbleDiameter / (0.5 * MOLTEN_SALT_PROPERTIES.DENSITY));
    }
  }

  static calculateBubbleCoverage(nucleationRate, growthRate, riseVelocity, detachedDiameter, localCurrentDensity, criticalCurrentDensity, aluminaConcentration) {
    const jRatio = localCurrentDensity / criticalCurrentDensity;
    const normalizedConc = Math.max(0.1, Math.min(aluminaConcentration / MULTIPHYSICS_CONSTANTS.ALUMINA_SATURATION, 1));
    const concentrationFactor = (0.3 + 0.7 * (1 - normalizedConc));
    const baseCoverage = 0.05 + 0.8 * (1 - Math.exp(-jRatio * 2.5)) * concentrationFactor;
    return Math.min(baseCoverage, MULTIPHYSICS_CONSTANTS.MAX_BUBBLE_COVERAGE);
  }
}

class Electrochemistry {
  static calculateCriticalCurrentDensity(aluminaConcentration, massTransferCoeff, moleRatio = 2.7) {
    const normalizedConc = Math.max(0.1, Math.min(aluminaConcentration / MULTIPHYSICS_CONSTANTS.ALUMINA_SATURATION, 1));
    const baseCritical = MULTIPHYSICS_CONSTANTS.CRITICAL_CURRENT_DENSITY_BASE * (0.15 + 0.85 * Math.pow(normalizedConc, 0.6));
    const mtFactor = 0.8 + 0.4 * (massTransferCoeff / 1.2e-5);
    const crFactor = 1 - 0.05 * (moleRatio - 2.7);
    return Math.round(baseCritical * mtFactor * crFactor * 1000) / 1000;
  }

  static calculateLocalCurrentDensity(appliedCurrentDensity, bubbleCoverage) {
    const effectiveAreaRatio = Math.max(1 - bubbleCoverage, 0.05);
    return appliedCurrentDensity / effectiveAreaRatio;
  }

  static calculateAnodeConsumptionRate(localCurrentDensity, aluminaConcentration, moleRatio = 2.7, temperature) {
    const currentEfficiency = 0.88 + 0.05 * (aluminaConcentration / MULTIPHYSICS_CONSTANTS.ALUMINA_SATURATION);
    const crFactor = 1 + 0.03 * (moleRatio - 2.7);
    const tempFactor = 1 + 0.002 * (temperature - 960);
    const theoreticalRate = (ANODE_PROPERTIES.MOLAR_MASS_C * localCurrentDensity * 10000) / 
                           (ANODE_PROPERTIES.STOICHIOMETRIC_FACTOR * ANODE_PROPERTIES.FARADAY * ANODE_PROPERTIES.CARBON_DENSITY);
    const actualRate = theoreticalRate * currentEfficiency * crFactor * tempFactor;
    return actualRate * 3600;
  }

  static calculateBubbleLayerResistance(bubbleCoverage, interpolarDistance, effectiveResistivity) {
    const effectiveArea = 1 - bubbleCoverage;
    const resistanceFactor = 1 / (effectiveArea * effectiveArea + 0.01);
    return effectiveResistivity * interpolarDistance * resistanceFactor;
  }

  static calculateNormalVoltage(appliedCurrentDensity, bubbleCoverage, interpolarDistance, effectiveResistivity, aluminaConcentration) {
    const ohmicDrop = appliedCurrentDensity * this.calculateBubbleLayerResistance(bubbleCoverage, interpolarDistance, effectiveResistivity);
    const decompositionVoltage = 1.7;
    const concentrationOverpotential = 0.15 + 0.08 * bubbleCoverage + 0.1 * (1 - aluminaConcentration / MULTIPHYSICS_CONSTANTS.ALUMINA_SATURATION);
    const activationOverpotential = 0.4 + 0.2 * Math.log(appliedCurrentDensity + 0.1);
    return MULTIPHYSICS_CONSTANTS.BASE_VOLTAGE + ohmicDrop + decompositionVoltage + concentrationOverpotential + activationOverpotential;
  }

  static calculateAnodeEffectVoltage(appliedCurrentDensity, aluminaConcentration, interpolarDistance, timeFactor) {
    const criticalJ = this.calculateCriticalCurrentDensity(aluminaConcentration, 1.2e-5);
    const excessRatio = Math.max(0, (appliedCurrentDensity - criticalJ) / criticalJ);
    const distanceFactor = 1 + (interpolarDistance - MULTIPHYSICS_CONSTANTS.INITIAL_INTERPOLAR_DISTANCE) * 10;
    const baseVoltage = MULTIPHYSICS_CONSTANTS.ANODE_EFFECT_VOLTAGE_BASE + excessRatio * MULTIPHYSICS_CONSTANTS.ARC_VOLTAGE_FACTOR * distanceFactor;
    const arcFlicker = 5 * Math.sin(timeFactor * 8) + 2 * Math.cos(timeFactor * 15);
    return baseVoltage + arcFlicker;
  }

  static calculateArcIntensity(localCurrentDensity, criticalCurrentDensity, bubbleCoverage, timeFactor) {
    const jRatio = localCurrentDensity / criticalCurrentDensity;
    if (jRatio < 0.90) return 0;
    let intensity = 0;
    if (jRatio >= 0.90 && jRatio < 1.0) {
      intensity = (jRatio - 0.90) / 0.10 * 0.3;
    } else if (jRatio >= 1.0) {
      intensity = 0.3 + Math.min(0.7, (jRatio - 1.0) * 0.4);
    }
    const flicker = 0.15 * Math.sin(timeFactor * 12) + 0.1 * Math.cos(timeFactor * 20);
    intensity += flicker;
    return Math.min(Math.max(intensity, 0), 1);
  }
}

class InterpolarDistanceModel {
  static calculate(initialAnodeHeight, consumedHeight, currentDensity, aluminaConcentration, moleRatio) {
    const currentAnodeHeight = Math.max(initialAnodeHeight - consumedHeight, MULTIPHYSICS_CONSTANTS.ANODE_HEIGHT_MIN);
    const heightReduction = initialAnodeHeight - currentAnodeHeight;
    const currentDensityFactor = 1 + (currentDensity - 0.5) * 0.1;
    const aluminaFactor = 1 - 0.02 * (aluminaConcentration - 4);
    const crFactor = 1 + 0.01 * (moleRatio - 2.7);
    const interpolarDistance = MULTIPHYSICS_CONSTANTS.INITIAL_INTERPOLAR_DISTANCE + 
                               heightReduction * 0.3 * currentDensityFactor * aluminaFactor * crFactor;
    return {
      interpolarDistance: Math.max(interpolarDistance, MULTIPHYSICS_CONSTANTS.INITIAL_INTERPOLAR_DISTANCE * 0.6),
      anodeHeight: currentAnodeHeight,
      anodeConsumption: consumedHeight
    };
  }
}

class MultiphysicsCoupling {
  static executeCoupledIteration(state) {
    const viscosity = MoltenSaltThermodynamics.calculateViscosity(
      state.aluminaConcentration, state.temperature, state.moleRatio
    );
    
    state.effectiveResistivity = MoltenSaltThermodynamics.calculateResistivity(
      state.aluminaConcentration, state.temperature, state.moleRatio, state.caF2Content
    );
    
    const surfaceTension = MoltenSaltThermodynamics.calculateSurfaceTension(
      state.aluminaConcentration, state.temperature
    );
    
    state.massTransferCoeff = MoltenSaltThermodynamics.calculateMassTransferCoeff(
      state.localCurrentDensity, state.aluminaConcentration, viscosity
    );
    
    state.criticalCurrentDensity = Electrochemistry.calculateCriticalCurrentDensity(
      state.aluminaConcentration, state.massTransferCoeff, state.moleRatio
    );
    
    const supersaturationRatio = Math.max(0.1, state.localCurrentDensity / state.criticalCurrentDensity);
    const nucleationRate = BubbleDynamics.calculateNucleationRate(
      state.localCurrentDensity, supersaturationRatio, surfaceTension
    );
    
    const bubbleGrowthRate = BubbleDynamics.calculateBubbleGrowthRate(
      state.localCurrentDensity, 1.0, viscosity
    );
    
    const detachedDiameter = BubbleDynamics.calculateDetachmentDiameter(surfaceTension, Math.PI / 4);
    state.bubbleDiameter = detachedDiameter;
    
    state.bubbleVelocity = BubbleDynamics.calculateRiseVelocity(detachedDiameter, viscosity);
    
    const newBubbleCoverage = BubbleDynamics.calculateBubbleCoverage(
      nucleationRate, bubbleGrowthRate, state.bubbleVelocity, detachedDiameter,
      state.localCurrentDensity, state.criticalCurrentDensity, state.aluminaConcentration
    );
    
    const normalizedConc = Math.max(0.1, Math.min(state.aluminaConcentration / MULTIPHYSICS_CONSTANTS.ALUMINA_SATURATION, 1));
    const feedbackSensitivity = Math.pow(1 - normalizedConc, 1.2);
    const feedbackGain = 0.35 + 0.55 * feedbackSensitivity;
    state.bubbleCoverage = state.bubbleCoverage * (1 - feedbackGain) + newBubbleCoverage * feedbackGain;
    state.bubbleCoverage = Math.min(Math.max(state.bubbleCoverage, 0.02), MULTIPHYSICS_CONSTANTS.MAX_BUBBLE_COVERAGE);
    
    state.localCurrentDensity = Electrochemistry.calculateLocalCurrentDensity(
      state.appliedCurrentDensity, state.bubbleCoverage
    );
    
    return state;
  }

  static simulateFullState(initialState) {
    let state = initialState.clone();
    
    for (let i = 0; i < MULTIPHYSICS_CONSTANTS.FEEDBACK_ITERATIONS; i++) {
      state = this.executeCoupledIteration(state);
    }
    
    const consumptionRate = Electrochemistry.calculateAnodeConsumptionRate(
      state.localCurrentDensity, state.aluminaConcentration, state.moleRatio, state.temperature
    );
    state.anodeConsumption = consumptionRate * state.elapsedTimeHours;
    
    const distanceResult = InterpolarDistanceModel.calculate(
      MULTIPHYSICS_CONSTANTS.ANODE_HEIGHT_INITIAL,
      state.anodeConsumption,
      state.appliedCurrentDensity,
      state.aluminaConcentration,
      state.moleRatio
    );
    state.interpolarDistance = distanceResult.interpolarDistance;
    state.anodeHeight = distanceResult.anodeHeight;
    
    const directTrigger = state.appliedCurrentDensity >= state.criticalCurrentDensity * 0.95;
    const feedbackTrigger = state.localCurrentDensity >= state.criticalCurrentDensity * 3.0 && state.bubbleCoverage > 0.55;
    state.isAnodeEffect = directTrigger || feedbackTrigger;
    state.isAnodeEffectImminent = !state.isAnodeEffect && 
      (state.appliedCurrentDensity >= state.criticalCurrentDensity * 0.80 || 
       state.localCurrentDensity >= state.criticalCurrentDensity * 1.5);
    
    state.arcIntensity = Electrochemistry.calculateArcIntensity(
      state.localCurrentDensity, state.criticalCurrentDensity, state.bubbleCoverage, state.timeFactor
    );
    
    if (state.isAnodeEffect) {
      state.cellVoltage = Electrochemistry.calculateAnodeEffectVoltage(
        state.appliedCurrentDensity, state.aluminaConcentration, state.interpolarDistance, state.timeFactor
      );
    } else {
      state.cellVoltage = Electrochemistry.calculateNormalVoltage(
        state.appliedCurrentDensity, state.bubbleCoverage, state.interpolarDistance, 
        state.effectiveResistivity, state.aluminaConcentration
      );
    }
    
    const dynamicFactor = 0.015 * Math.sin(state.timeFactor * 2) + 0.008 * Math.cos(state.timeFactor * 3.5);
    state.bubbleCoverage += dynamicFactor;
    state.bubbleCoverage = Math.min(Math.max(state.bubbleCoverage, 0.02), MULTIPHYSICS_CONSTANTS.MAX_BUBBLE_COVERAGE);
    
    return state;
  }
}

function simulate(appliedCurrentDensity, aluminaConcentration, timeFactor = 0, elapsedTimeHours = 0, options = {}) {
  const initialState = new MultiphysicsState({
    appliedCurrentDensity,
    aluminaConcentration,
    timeFactor,
    elapsedTimeHours,
    moleRatio: options.moleRatio || MULTIPHYSICS_CONSTANTS.NORMAL_MOLE_RATIO,
    caF2Content: options.caF2Content || 5.0,
    temperature: options.temperature || MOLTEN_SALT_PROPERTIES.NORMAL_OPERATION_TEMP
  });
  
  const finalState = MultiphysicsCoupling.simulateFullState(initialState);
  
  return {
    currentDensity: finalState.appliedCurrentDensity,
    localCurrentDensity: Math.round(finalState.localCurrentDensity * 1000) / 1000,
    aluminaConcentration: finalState.aluminaConcentration,
    moleRatio: finalState.moleRatio,
    caF2Content: finalState.caF2Content,
    temperature: finalState.temperature,
    criticalCurrentDensity: finalState.criticalCurrentDensity,
    bubbleCoverage: Math.round(finalState.bubbleCoverage * 1000) / 1000,
    bubbleDiameter: Math.round(finalState.bubbleDiameter * 10000) / 10000,
    bubbleVelocity: Math.round(finalState.bubbleVelocity * 1000) / 1000,
    massTransferCoeff: finalState.massTransferCoeff,
    effectiveResistivity: Math.round(finalState.effectiveResistivity * 1000) / 1000,
    cellVoltage: Math.round(finalState.cellVoltage * 100) / 100,
    isAnodeEffect: finalState.isAnodeEffect,
    isAnodeEffectImminent: finalState.isAnodeEffectImminent,
    arcIntensity: Math.round(finalState.arcIntensity * 100) / 100,
    interpolarDistance: Math.round(finalState.interpolarDistance * 10000) / 10000,
    anodeHeight: Math.round(finalState.anodeHeight * 1000) / 1000,
    anodeConsumption: Math.round(finalState.anodeConsumption * 1000) / 1000,
    timeFactor: finalState.timeFactor,
    elapsedTimeHours: Math.round(finalState.elapsedTimeHours * 100) / 100
  };
}

function calculateCriticalCurrentDensity(aluminaConcentration) {
  return Electrochemistry.calculateCriticalCurrentDensity(
    aluminaConcentration, 1.2e-5, MULTIPHYSICS_CONSTANTS.NORMAL_MOLE_RATIO
  );
}

function calculateBubbleCoverageWithFeedback(appliedCurrentDensity, aluminaConcentration, timeFactor = 0) {
  const result = simulate(appliedCurrentDensity, aluminaConcentration, timeFactor, 0);
  return {
    bubbleCoverage: result.bubbleCoverage,
    localCurrentDensity: result.localCurrentDensity,
    criticalCurrentDensity: result.criticalCurrentDensity
  };
}

function calculateAnodeConsumption(currentDensity, elapsedTimeHours, aluminaConcentration = 5.0, moleRatio = 2.7, temperature = 960) {
  const consumptionRate = Electrochemistry.calculateAnodeConsumptionRate(
    currentDensity, aluminaConcentration, moleRatio, temperature
  );
  return consumptionRate * elapsedTimeHours;
}

function calculateInterpolarDistance(initialAnodeHeight, consumedHeight, currentDensity) {
  return InterpolarDistanceModel.calculate(
    initialAnodeHeight, consumedHeight, currentDensity, 5.0, MULTIPHYSICS_CONSTANTS.NORMAL_MOLE_RATIO
  );
}

function generateBubbles(count, bubbleCoverage, width, height) {
  const bubbles = [];
  const effectiveCount = Math.floor(count * bubbleCoverage);
  
  for (let i = 0; i < effectiveCount; i++) {
    const size = 3 + Math.random() * 15 * (0.5 + bubbleCoverage);
    const x = Math.random() * width;
    const y = height * (0.3 + Math.random() * 0.65);
    const speed = 0.5 + Math.random() * 2;
    const phase = Math.random() * Math.PI * 2;
    
    bubbles.push({
      id: i,
      x,
      y,
      radius: size / 2,
      speed,
      phase,
      wobble: Math.random() * 2
    });
  }
  
  return bubbles;
}

module.exports = {
  simulate,
  calculateCriticalCurrentDensity,
  calculateBubbleCoverageWithFeedback,
  calculateAnodeConsumption,
  calculateInterpolarDistance,
  generateBubbles,
  MultiphysicsState,
  MoltenSaltThermodynamics,
  BubbleDynamics,
  Electrochemistry,
  InterpolarDistanceModel,
  MultiphysicsCoupling,
  CONSTANTS: MULTIPHYSICS_CONSTANTS,
  MOLTEN_SALT_PROPERTIES,
  ANODE_PROPERTIES
};
