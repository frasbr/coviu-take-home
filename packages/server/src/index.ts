import { buildServer } from "./buildServer.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const server = buildServer({ databasePath: "data/app.db", clientUrl: CLIENT_URL });

server.listen(PORT, () => {
  console.log(`server listening on port ${PORT}`);
});
