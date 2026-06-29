/**
 * PORT for generating unique identifiers. Keeps the use cases free of
 * direct dependencies on crypto / uuid libraries.
 */
export interface IdGenerator {
  generate(): string;
}
