const URL = "https://umzeixsgchlddlbxhmqi.supabase.co";
const KEY = "sb_publishable_ooXYX7iuH5jKxEgN-c3TDg_lcVEZ5vD";

async function run() {
  try {
    const res = await fetch(`${URL}/rest/v1/`, {
      headers: {
        'apikey': KEY
      }
    });
    const schema = await res.json();
    console.log("TABLES:", Object.keys(schema.definitions || {}));
    if (schema.definitions && schema.definitions.policies) {
      console.log("POLICIES:", Object.keys(schema.definitions.policies.properties));
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

run();
