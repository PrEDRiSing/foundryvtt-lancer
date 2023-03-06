import * as t from "io-ts";
import { either } from "fp-ts";

function unwrap<E, A>(e: either.Either<E, A>): A {
  if (either.isLeft(e)) {
    throw e.left;
  } else {
    return e.right;
  }
}

export function enclass<Raw, Klass extends { get raw(): Raw }, I, O>(
  codec: t.Type<Raw, O, I>,
  Constructor: new (bag: Raw) => Klass
) {
  return new t.Type<Klass, O, I>(
    Constructor.name,
    (v: unknown): v is Klass => v instanceof Constructor,
    data => either.map((d: Raw) => new Constructor(d))(codec.decode(data)),
    inst => codec.encode(inst.raw)
  );
}

export function stateless<T>(name: string, predicate: t.Is<T>, synthesise: () => T) {
  return new t.Type<T, null, unknown>(
    name,
    predicate,
    _ => either.right(synthesise()),
    _ => null
  );
}

export function encode<Raw, T>(t: T, codec: t.Type<T, Raw, any>): Raw {
  return codec.encode(t);
}
export function decode<Raw, T>(r: Raw, codec: t.Type<T, Raw, any>): T {
  return unwrap(codec.decode(r));
}
