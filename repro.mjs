import { Effect } from "effect";
import { Entity, EntityProxy, EntityProxyServer, Sharding } from "effect/unstable/cluster";
import { Rpc, RpcClient, RpcServer } from "effect/unstable/rpc";

const TestEntity = Entity.make("TestEntity", [Rpc.make("NoPayload")]);
const TestEntityRpcs = EntityProxy.toRpcGroup(TestEntity);

let server;

const program = Effect.gen(function* () {
  const sharding = {
    makeClient: () =>
      Effect.succeed((entityId) => ({
        NoPayload: (payload, options) =>
          Effect.log(
            `entity ${entityId} payload:${String(payload)} discard:${String(options?.discard)}`
          ),
      })),
    isShutdown: Effect.succeed(false),
    pollStorage: Effect.void,
  };

  const clientSide = yield* RpcClient.makeNoSerialization(TestEntityRpcs, {
    supportsAck: true,
    onFromClient: ({ message }) => server.write(0, message),
  });

  server = yield* RpcServer.makeNoSerialization(TestEntityRpcs, {
    onFromServer: (response) => clientSide.write(response),
  }).pipe(
    Effect.provide(EntityProxyServer.layerRpcHandlers(TestEntity)),
    Effect.provideService(Sharding.Sharding, sharding)
  );

  yield* clientSide.client["TestEntity.NoPayloadDiscard"]({
    entityId: "id",
    payload: undefined,
  });
});

Effect.runPromise(Effect.scoped(program)).then(
  () => console.log("ok"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
