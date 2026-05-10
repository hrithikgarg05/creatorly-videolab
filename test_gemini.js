const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testModel(modelName) {
  try {
    const genAI = new GoogleGenerativeAI('dummy_key');
    const model = genAI.getGenerativeModel({ model: modelName });
    await model.generateContent("hello");
  } catch (e) {
    console.log(`${modelName}: ${e.message}`);
  }
}

async function run() {
  await testModel('gemini-1.5-flash');
  await testModel('gemini-1.5-flash-latest');
  await testModel('gemini-1.5-pro');
  await testModel('gemini-pro-vision');
}
run();
