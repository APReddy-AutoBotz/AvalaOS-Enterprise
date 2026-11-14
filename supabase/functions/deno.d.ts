declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
  /** Present in the Deno runtime; checked before use. */
  resolveDns?: (query: string, recordType: 'A' | 'AAAA') => Promise<string[]>;
};
