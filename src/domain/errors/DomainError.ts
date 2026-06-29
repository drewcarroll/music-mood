/**
 * Base class for all errors raised by the domain layer.
 * Infrastructure must catch raw I/O errors and re-throw as domain/application
 * errors so the outer layers never depend on framework-specific exceptions.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an operation is attempted on a session in an invalid state. */
export class InvalidSessionStateError extends DomainError {}
