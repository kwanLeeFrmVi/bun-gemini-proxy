# Code Style and Conventions

## TypeScript Configuration
- **Strict Mode**: Enabled with all strict checks
- **Target**: ESNext (latest JavaScript features)
- **Module**: Preserve with bundler resolution
- **Important Flags**:
  - `strict: true` - All strict type checks enabled
  - `noUncheckedIndexedAccess: true` - Safer array/object access
  - `noImplicitOverride: true` - Explicit override keyword required
  - `noFallthroughCasesInSwitch: true` - Prevents accidental fallthrough

## Coding Conventions

### File Organization
- Use `.ts` extension for TypeScript files
- Allow `.tsx` for React components if needed
- Keep module files focused and single-purpose
- Group related functionality in directories

### Naming Conventions
- **Files**: kebab-case (e.g., `key-manager.ts`, `health-monitor.ts`)
- **Classes**: PascalCase (e.g., `KeyManager`, `CircuitBreaker`)
- **Interfaces**: PascalCase with optional 'I' prefix (e.g., `ApiKey`, `IHealthScore`)
- **Functions/Methods**: camelCase (e.g., `rotateKeys()`, `checkHealth()`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Private members**: Prefix with underscore (e.g., `_privateMethod()`)

### TypeScript Best Practices
- Always use explicit types for function parameters
- Use type inference for local variables when obvious
- Prefer interfaces over type aliases for object shapes
- Use enums for fixed sets of values
- Leverage union types for state modeling

### Async/Await Patterns
```typescript
// Prefer async/await over promises
async function fetchData(): Promise<Data> {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    // Handle errors appropriately
    throw new Error(`Failed to fetch: ${error}`);
  }
}
```

### Error Handling
- Use try-catch for async operations
- Create custom error classes for specific error types
- Always log errors with context
- Return meaningful error messages to clients

### Bun-Specific Patterns
```typescript
// Use Bun.serve instead of Express
Bun.serve({
  port: 4806,
  async fetch(req) {
    // Handle request
  }
});

// Use bun:sqlite instead of better-sqlite3
import { Database } from "bun:sqlite";

// Use Bun.file for file operations
const file = Bun.file("config.yaml");
const content = await file.text();
```

### Comments and Documentation
- Use JSDoc for public APIs
- Inline comments for complex logic
- TODO comments for pending work
- Avoid obvious comments

### Testing Conventions
```typescript
import { test, expect, describe } from "bun:test";

describe("ComponentName", () => {
  test("should do something specific", () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected);
  });
});
```

## Import Organization
1. External dependencies (npm packages)
2. Bun-specific imports (bun:*)
3. Internal modules (relative paths)
4. Type imports

```typescript
import { Something } from "external-package";
import { Database } from "bun:sqlite";
import { KeyManager } from "./key-manager";
import type { ApiKey } from "./types";
```

## Code Quality Rules
- No unused variables or imports
- Handle all promise rejections
- Validate input data
- Use const by default, let only when reassignment needed
- Avoid any type - use unknown and type guards instead
- Keep functions small and focused (< 50 lines ideally)
- Extract magic numbers to named constants