import "@testing-library/jest-dom";
import * as axeMatchers from "vitest-axe/matchers";
import { expect } from "vitest";
import "../i18n"; // initializes i18next once for all tests — components using useTranslation() need this ready before render

expect.extend(axeMatchers);
