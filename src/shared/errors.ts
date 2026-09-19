export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string = code) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
