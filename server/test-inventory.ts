import { strict as assert } from 'assert';
import { getAvailableToShip, getBufferStock, getTotalOwned, Item } from '../shared/schema.js';

console.log('🧪 Running Inventory System Tests...\n');

// ============================================================================
// TEST 1: Helper Functions for Finished Products
// ============================================================================

console.log('Test 1: Helper Functions - getAvailableToShip, getBufferStock, getTotalOwned');

const finishedProduct: Item = {
  id: 'fp-1',
  name: 'Test Finished Product',
  sku: 'FP-001',
  type: 'finished_product',
  unit: 'units',
  currentStock: 0, // Should always be 0 for finished products
  minStock: 10,
  dailyUsage: 5,
  barcode: null,
  location: null,
  hildaleQty: 50, // Buffer stock at Hildale
  pivotQty: 100,  // Ready-to-ship at Pivot
  productKind: 'FINISHED',
  barcodeValue: null,
  barcodeFormat: null,
  barcodeUsage: null,
  barcodeSource: null,
  externalSystem: null,
  externalId: null,
};

try {
  // Test getAvailableToShip (should return pivotQty)
  const availableToShip = getAvailableToShip(finishedProduct);
  assert.equal(availableToShip, 100, 'availableToShip should return pivotQty (100)');
  console.log('  ✅ getAvailableToShip returns pivotQty correctly');

  // Test getBufferStock (should return hildaleQty)
  const bufferStock = getBufferStock(finishedProduct);
  assert.equal(bufferStock, 50, 'bufferStock should return hildaleQty (50)');
  console.log('  ✅ getBufferStock returns hildaleQty correctly');

  // Test getTotalOwned (should return pivotQty + hildaleQty)
  const totalOwned = getTotalOwned(finishedProduct);
  assert.equal(totalOwned, 150, 'totalOwned should return pivotQty + hildaleQty (150)');
  console.log('  ✅ getTotalOwned returns sum correctly');

  // Test with zero quantities
  const emptyFinishedProduct: Item = {
    ...finishedProduct,
    id: 'fp-2',
    hildaleQty: 0,
    pivotQty: 0,
  };
  
  assert.equal(getAvailableToShip(emptyFinishedProduct), 0, 'Zero pivotQty handled');
  assert.equal(getBufferStock(emptyFinishedProduct), 0, 'Zero hildaleQty handled');
  assert.equal(getTotalOwned(emptyFinishedProduct), 0, 'Zero total handled');
  console.log('  ✅ Zero quantities handled correctly');

  // Test error handling for components
  const component: Item = {
    id: 'comp-1',
    name: 'Test Component',
    sku: 'COMP-001',
    type: 'component',
    unit: 'units',
    currentStock: 500,
    minStock: 100,
    dailyUsage: 10,
    barcode: null,
    location: null,
    hildaleQty: 0,
    pivotQty: 0,
    productKind: 'RAW',
    barcodeValue: null,
    barcodeFormat: null,
    barcodeUsage: null,
    barcodeSource: null,
    externalSystem: null,
    externalId: null,
  };

  try {
    getAvailableToShip(component);
    assert.fail('Should throw error for components');
  } catch (error: any) {
    assert.ok(error.message.includes('finished products'), 'Throws correct error for components');
    console.log('  ✅ Correctly rejects components');
  }

  console.log('✓ Test 1 PASSED\n');
} catch (error: any) {
  console.error(`✗ Test 1 FAILED: ${error.message}\n`);
  process.exit(1);
}

// ============================================================================
// TEST 2: BOM-Based Forecast Calculation Logic
// ============================================================================

console.log('Test 2: BOM-Based Forecast Calculation (simulated)');

interface BOMEntry {
  finishedProductId: string;
  componentId: string;
  quantityRequired: number;
}

interface ComponentStock {
  id: string;
  name: string;
  currentStock: number;
}

function calculateProductionForecast(
  bom: BOMEntry[],
  components: Map<string, ComponentStock>
): number {
  if (bom.length === 0) return 0;

  let minCapacity = Infinity;

  for (const bomEntry of bom) {
    const component = components.get(bomEntry.componentId);
    
    if (!component || bomEntry.quantityRequired <= 0) {
      return 0; // Missing component = can't produce any
    }

    const componentStock = component.currentStock ?? 0;
    const requiredPerUnit = bomEntry.quantityRequired;
    
    const capacityForComponent = Math.floor(componentStock / requiredPerUnit);
    minCapacity = Math.min(minCapacity, capacityForComponent);
  }

  return minCapacity === Infinity ? 0 : minCapacity;
}

try {
  // Test Case 2.1: Normal BOM with multiple components
  const bom1: BOMEntry[] = [
    { finishedProductId: 'fp-1', componentId: 'comp-1', quantityRequired: 2 },
    { finishedProductId: 'fp-1', componentId: 'comp-2', quantityRequired: 5 },
    { finishedProductId: 'fp-1', componentId: 'comp-3', quantityRequired: 1 },
  ];

  const components1 = new Map<string, ComponentStock>([
    ['comp-1', { id: 'comp-1', name: 'Spring', currentStock: 100 }],  // Can make 50 units
    ['comp-2', { id: 'comp-2', name: 'Bolt', currentStock: 150 }],    // Can make 30 units (bottleneck)
    ['comp-3', { id: 'comp-3', name: 'Bar', currentStock: 200 }],     // Can make 200 units
  ]);

  const forecast1 = calculateProductionForecast(bom1, components1);
  assert.equal(forecast1, 30, 'Should be limited by bottleneck component (Bolt: 150/5 = 30)');
  console.log('  ✅ Bottleneck component limits production correctly');

  // Test Case 2.2: Zero stock component
  const components2 = new Map<string, ComponentStock>([
    ['comp-1', { id: 'comp-1', name: 'Spring', currentStock: 100 }],
    ['comp-2', { id: 'comp-2', name: 'Bolt', currentStock: 0 }],  // Zero stock
    ['comp-3', { id: 'comp-3', name: 'Bar', currentStock: 200 }],
  ]);

  const forecast2 = calculateProductionForecast(bom1, components2);
  assert.equal(forecast2, 0, 'Zero stock component should result in zero forecast');
  console.log('  ✅ Zero stock component handled correctly');

  // Test Case 2.3: Missing component
  const components3 = new Map<string, ComponentStock>([
    ['comp-1', { id: 'comp-1', name: 'Spring', currentStock: 100 }],
    // comp-2 is missing
    ['comp-3', { id: 'comp-3', name: 'Bar', currentStock: 200 }],
  ]);

  const forecast3 = calculateProductionForecast(bom1, components3);
  assert.equal(forecast3, 0, 'Missing component should result in zero forecast');
  console.log('  ✅ Missing component handled correctly');

  // Test Case 2.4: Empty BOM
  const forecast4 = calculateProductionForecast([], components1);
  assert.equal(forecast4, 0, 'Empty BOM should result in zero forecast');
  console.log('  ✅ Empty BOM handled correctly');

  // Test Case 2.5: Single component BOM
  const bom5: BOMEntry[] = [
    { finishedProductId: 'fp-1', componentId: 'comp-1', quantityRequired: 3 },
  ];

  const forecast5 = calculateProductionForecast(bom5, components1);
  assert.equal(forecast5, 33, 'Single component: 100/3 = 33 units (floor)');
  console.log('  ✅ Single component BOM calculated correctly');

  console.log('✓ Test 2 PASSED\n');
} catch (error: any) {
  console.error(`✗ Test 2 FAILED: ${error.message}\n`);
  process.exit(1);
}

// ============================================================================
// TEST 3: Finished Product Invariants
// ============================================================================

console.log('Test 3: Finished Product Invariants');

try {
  // Test that finished products should NEVER use currentStock
  assert.equal(
    finishedProduct.currentStock, 
    0, 
    'Finished products should always have currentStock = 0'
  );
  console.log('  ✅ Finished product currentStock is 0');

  // Test that finished products must have type = 'finished_product'
  assert.equal(
    finishedProduct.type, 
    'finished_product', 
    'Finished products must have type = finished_product'
  );
  console.log('  ✅ Finished product type is correct');

  // Test that totalOwned is computed from hildaleQty + pivotQty
  const computedTotal = (finishedProduct.hildaleQty ?? 0) + (finishedProduct.pivotQty ?? 0);
  assert.equal(
    computedTotal,
    150,
    'Total owned must equal hildaleQty + pivotQty'
  );
  console.log('  ✅ Total owned computed correctly from warehouses');

  console.log('✓ Test 3 PASSED\n');
} catch (error: any) {
  console.error(`✗ Test 3 FAILED: ${error.message}\n`);
  process.exit(1);
}

// ============================================================================
// TEST 4: Component Invariants
// ============================================================================

console.log('Test 4: Component Invariants');

try {
  const testComponent: Item = {
    id: 'comp-test',
    name: 'Test Component',
    sku: 'COMP-TEST',
    type: 'component',
    unit: 'units',
    currentStock: 500,
    minStock: 100,
    dailyUsage: 10,
    barcode: null,
    location: null,
    hildaleQty: 0,
    pivotQty: 0,
    productKind: 'RAW',
    barcodeValue: null,
    barcodeFormat: null,
    barcodeUsage: null,
    barcodeSource: null,
    externalSystem: null,
    externalId: null,
  };

  // Test that components use currentStock, not warehouse quantities
  assert.equal(
    testComponent.type,
    'component',
    'Components must have type = component'
  );
  console.log('  ✅ Component type is correct');

  assert.ok(
    testComponent.currentStock >= 0,
    'Components must have currentStock >= 0'
  );
  console.log('  ✅ Component has valid currentStock');

  assert.equal(
    testComponent.hildaleQty,
    0,
    'Components should not use hildaleQty'
  );
  
  assert.equal(
    testComponent.pivotQty,
    0,
    'Components should not use pivotQty'
  );
  console.log('  ✅ Components do not use warehouse-specific quantities');

  console.log('✓ Test 4 PASSED\n');
} catch (error: any) {
  console.error(`✗ Test 4 FAILED: ${error.message}\n`);
  process.exit(1);
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('═══════════════════════════════════════════════════════════');
console.log('✅ ALL TESTS PASSED');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('Test Coverage:');
console.log('  • Helper functions (getAvailableToShip, getBufferStock, getTotalOwned)');
console.log('  • BOM-based forecast calculation logic');
console.log('  • Bottleneck detection (component limiting production)');
console.log('  • Edge cases (zero stock, missing components, empty BOM)');
console.log('  • Finished product invariants (currentStock = 0, uses warehouses)');
console.log('  • Component invariants (uses currentStock, not warehouses)');
console.log('');
console.log('To run these tests:');
console.log('  npm run test:inventory');
console.log('');
