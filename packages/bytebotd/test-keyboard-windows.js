// Simple nut.js keyboard test for Windows diagnostics
// This script tests nut.js keyboard functionality directly on Windows
// to isolate issues from our service code
//
// Usage:
//   1. Open VS Code or Notepad
//   2. Focus the editor window
//   3. Run: node test-keyboard-windows.js
//   4. Check if text appears in the focused window

const { keyboard, Key } = require('@nut-tree-fork/nut-js');

console.log('===========================================');
console.log('  nut.js Windows Keyboard Diagnostic');
console.log('===========================================\n');
console.log('This script will test keyboard functionality in 3 seconds...');
console.log('Make sure you have VS Code or Notepad FOCUSED!\n');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  try {
    // Give user time to focus the window
    console.log('Waiting 3 seconds for you to focus the target window...');
    await sleep(3000);

    // Configure keyboard delay
    keyboard.config.autoDelayMs = 100;
    console.log('✓ Configured keyboard.config.autoDelayMs = 100ms\n');

    // Try to set native adapter delay (if supported)
    try {
      keyboard.nativeAdapter.keyboard.setKeyboardDelay(100);
      console.log('✓ Set native adapter keyboard delay = 100ms\n');
    } catch (e) {
      console.log('⚠ Native adapter setKeyboardDelay not available (this is OK)\n');
    }

    // Test 1: Single character with manual delay
    console.log('Test 1: Pressing A key with manual delay...');
    await keyboard.pressKey(Key.A);
    await sleep(100);
    await keyboard.releaseKey(Key.A);
    console.log('✓ Test 1 complete - you should see "a" in the focused window\n');
    await sleep(500);

    // Test 2: Multiple characters with pressKey/releaseKey
    console.log('Test 2: Typing "HELLO" character by character...');
    const chars = [Key.H, Key.E, Key.L, Key.L, Key.O];
    for (const char of chars) {
      await keyboard.pressKey(char);
      await sleep(100);
      await keyboard.releaseKey(char);
      await sleep(50);
    }
    console.log('✓ Test 2 complete - you should see "aHELLO"\n');
    await sleep(500);

    // Test 3: Using keyboard.type() method
    console.log('Test 3: Using keyboard.type() method...');
    await keyboard.type(' WORLD');
    console.log('✓ Test 3 complete - you should see "aHELLO WORLD"\n');
    await sleep(500);

    // Test 4: Key combination (Enter to go to new line)
    console.log('Test 4: Pressing Enter key...');
    await keyboard.pressKey(Key.Enter);
    await sleep(100);
    await keyboard.releaseKey(Key.Enter);
    console.log('✓ Test 4 complete - cursor should be on new line\n');
    await sleep(500);

    // Test 5: Key combination (Ctrl+B for bold in some apps)
    console.log('Test 5: Pressing Ctrl+B combination...');
    await keyboard.pressKey(Key.LeftControl, Key.B);
    await sleep(100);
    await keyboard.releaseKey(Key.LeftControl, Key.B);
    console.log('✓ Test 5 complete - Ctrl+B sent\n');
    await sleep(500);

    // Test 6: Type a test message
    console.log('Test 6: Typing full test message...');
    await keyboard.type('SUCCESS! nut.js keyboard works on Windows!');
    console.log('✓ Test 6 complete\n');

    console.log('===========================================');
    console.log('  All tests completed successfully!');
    console.log('===========================================\n');
    console.log('Expected output in focused window:');
    console.log('aHELLO WORLD');
    console.log('SUCCESS! nut.js keyboard works on Windows!\n');
    console.log('If you see this text, nut.js works correctly.');
    console.log('If not, there may be a Windows VM compatibility issue.');

  } catch (error) {
    console.error('\n❌ ERROR occurred during testing:');
    console.error(error);
    console.error('\nThis indicates nut.js keyboard may not work in this environment.');
    process.exit(1);
  }
}

test();
