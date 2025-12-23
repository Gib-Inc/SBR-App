import pg from "pg";
const { Pool } = pg;

const AMAZON_ORDERS = ["11921", "11920", "11919", "11918", "11912", "11911", "11910", "11909"];
const SHOPIFY_ORDERS = ["11917", "11916", "11915", "11914", "11913", "11906", "11904", "11901"];

async function fetchOrder(orderNum: string, shopDomain: string, accessToken: string) {
  const query = `
    query {
      orders(first: 1, query: "name:#${orderNum}") {
        nodes {
          id
          name
          sourceIdentifier
          sourceName
          tags
          app {
            id
            name
          }
          channelInformation {
            channelId
            channelDefinition {
              handle
              channelName
            }
            app {
              id
              title
            }
          }
          customAttributes {
            key
            value
          }
        }
      }
    }
  `;
  
  const response = await fetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });
  
  return await response.json();
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const result = await pool.query("SELECT api_key, config FROM integration_configs WHERE provider = 'SHOPIFY' LIMIT 1");
  
  const config = result.rows[0].config;
  const accessToken = result.rows[0].api_key;
  const shopDomain = config.shopDomain;
  
  console.log("=== AMAZON ORDERS ===\n");
  for (const orderNum of AMAZON_ORDERS) {
    const data = await fetchOrder(orderNum, shopDomain, accessToken);
    const order = data.data?.orders?.nodes?.[0];
    if (order) {
      console.log(`--- ${order.name} ---`);
      console.log(`  sourceIdentifier: ${order.sourceIdentifier || 'null'}`);
      console.log(`  sourceName: ${order.sourceName || 'null'}`);
      console.log(`  app.name: ${order.app?.name || 'null'}`);
      console.log(`  app.id: ${order.app?.id || 'null'}`);
      console.log(`  channelInfo.handle: ${order.channelInformation?.channelDefinition?.handle || 'null'}`);
      console.log(`  channelInfo.channelName: ${order.channelInformation?.channelDefinition?.channelName || 'null'}`);
      console.log(`  channelInfo.app.title: ${order.channelInformation?.app?.title || 'null'}`);
      console.log(`  channelInfo.app.id: ${order.channelInformation?.app?.id || 'null'}`);
      console.log(`  tags: ${JSON.stringify(order.tags)}`);
      console.log();
    }
  }
  
  console.log("\n=== SHOPIFY ORDERS ===\n");
  for (const orderNum of SHOPIFY_ORDERS) {
    const data = await fetchOrder(orderNum, shopDomain, accessToken);
    const order = data.data?.orders?.nodes?.[0];
    if (order) {
      console.log(`--- ${order.name} ---`);
      console.log(`  sourceIdentifier: ${order.sourceIdentifier || 'null'}`);
      console.log(`  sourceName: ${order.sourceName || 'null'}`);
      console.log(`  app.name: ${order.app?.name || 'null'}`);
      console.log(`  app.id: ${order.app?.id || 'null'}`);
      console.log(`  channelInfo.handle: ${order.channelInformation?.channelDefinition?.handle || 'null'}`);
      console.log(`  channelInfo.channelName: ${order.channelInformation?.channelDefinition?.channelName || 'null'}`);
      console.log(`  channelInfo.app.title: ${order.channelInformation?.app?.title || 'null'}`);
      console.log(`  channelInfo.app.id: ${order.channelInformation?.app?.id || 'null'}`);
      console.log(`  tags: ${JSON.stringify(order.tags)}`);
      console.log();
    }
  }
  
  await pool.end();
  process.exit(0);
}

main().catch(console.error);
