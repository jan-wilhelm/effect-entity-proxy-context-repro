# Add a title

EntityProxyServer.layerRpcHandlers crashes entity proxy RPC calls because handler entries use `services` instead of `context`

# What steps can reproduce the bug?

Using `effect@4.0.0-beta.56`, create an entity, expose it through `EntityProxy.toRpcGroup`, provide handlers with `EntityProxyServer.layerRpcHandlers`, and call the generated RPC client.

A runnable reproduction repo is available at: https://github.com/jan-wilhelm/effect-entity-proxy-context-repro

Minimal reproduction:

```js
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
```

For example:

```sh
bun add effect@4.0.0-beta.56
bun repro.mjs
```

# What is the expected behavior?

The generated entity proxy RPC should call the entity client handler and complete successfully. In the repro above, it should log something like:

```txt
entity id payload:undefined discard:true
ok
```

# What do you see instead?

The RPC server crashes before the entity handler is invoked:

```txt
TypeError: undefined is not an object (evaluating 'entry.context.mapUnsafe')
  at handleRequest (.../effect/dist/unstable/rpc/RpcServer.js:226:35)
```

In a websocket RPC setup, this can surface on the client with a stack around schema decoding / `RpcClient`, but the underlying defect appears to be the server-side handler entry shape.

# Additional information

The issue appears to be in `EntityProxyServer.layerRpcHandlers`.

In `effect@4.0.0-beta.56`, `dist/unstable/cluster/EntityProxyServer.js` registers handlers like this:

```js
handlers.set(key, {
  services,
  tag,
  handler: ({ entityId, payload }) => client(entityId)[parentRpc._tag](payload)
});

handlers.set(`${key}Discard`, {
  services,
  tag,
  handler: ({ entityId, payload }) =>
    client(entityId)[parentRpc._tag](payload, { discard: true })
});
```

But `dist/unstable/rpc/RpcServer.js` expects the handler entry to have `context`:

```js
const context = new Map(entry.context.mapUnsafe);
```

`RpcGroup.toHandlers` also appears to use the expected shape:

```js
contextMap.set(rpc.key, {
  tag: rpc._tag,
  handler,
  context: services
});
```

Changing the two `EntityProxyServer.layerRpcHandlers` entries from:

```js
services,
```

to:

```js
context: services,
```

makes the repro pass locally.

I also verified that a direct entity client discard call with `payload: undefined` succeeds, so this does not appear to be caused by no-payload RPCs / `Schema.Void`. I checked the distributed JS in `effect@4.0.0-beta.57` and `effect@4.0.0-beta.58`, and both appeared to have the same `services` field in `EntityProxyServer.layerRpcHandlers`.
