import { runGenerationPipeline } from "../lib/generation-pipeline";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const idType = { kind: "NON_NULL", ofType: { kind: "SCALAR", name: "ID" } };
const stringType = { kind: "SCALAR", name: "String" };
const userType = { kind: "OBJECT", name: "User" };

const introspection = {
  endpoint: "https://graphql.example.com/graphql",
  title: "Example GraphQL API",
  data: {
    __schema: {
      queryType: { name: "Query" },
      mutationType: { name: "Mutation" },
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "user",
              description: "Fetch a user by ID.",
              args: [{ name: "id", type: idType, description: "User ID." }],
              type: userType,
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "Mutation",
          fields: [
            {
              name: "renameUser",
              description: "Rename a user.",
              args: [
                { name: "id", type: idType, description: "User ID." },
                { name: "name", type: { kind: "NON_NULL", ofType: stringType }, description: "New name." },
              ],
              type: userType,
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "User",
          fields: [
            { name: "id", args: [], type: { kind: "SCALAR", name: "ID" } },
            { name: "name", args: [], type: stringType },
          ],
        },
        { kind: "SCALAR", name: "ID" },
        { kind: "SCALAR", name: "String" },
      ],
    },
  },
};

async function main() {
  const generated = await runGenerationPipeline({
    sourceType: "json_paste",
    rawJson: JSON.stringify(introspection),
    generationMode: "dynamic",
    clientPreset: "default",
  });

  assert(generated.endpointMap.length === 2, `Expected 2 GraphQL endpoints, got ${generated.endpointMap.length}.`);
  const user = generated.endpointMap.find((endpoint) => endpoint.operation_id === "query_user");
  assert(user, "Expected query_user endpoint.");
  assert(user?.runtime_kind === "graphql", `Expected GraphQL runtime kind, got ${user?.runtime_kind}.`);
  assert(user?.base_url === "https://graphql.example.com/graphql", `Unexpected GraphQL endpoint URL: ${user?.base_url}.`);

  const schema = user?.input_schema ?? {};
  const text = JSON.stringify(schema);
  assert(text.includes('"id"'), "Expected ID variable in tool input schema.");
  assert(!text.includes("query Fetch"), "Expected generated tool input not to expose raw query editing.");

  const requestSchema = user?.request_body_schema as Record<string, unknown> | undefined;
  assert(typeof requestSchema?.["x-astrail-graphql-query"] === "string", "Expected fixed GraphQL query metadata.");
  assert(String(requestSchema?.["x-astrail-graphql-query"]).includes("query query_user"), "Expected generated query operation.");
  assert(String(requestSchema?.["x-astrail-graphql-query"]).includes("user(id: $id)"), "Expected generated field arguments.");

  console.log("PASS: GraphQL introspection imports into deterministic Astrail endpoint maps.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
