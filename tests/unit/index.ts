// Unit tests entry point
export {};

// Application use case tests
import './application/use-cases/SearchUseCase.test.js';
import './application/use-cases/ComposeLineUseCase.test.js';
import './application/use-cases/RecordFeedbackUseCase.test.js';
import './application/use-cases/MvpPrefilterIntegration.test.js';

// Infrastructure configuration tests
import './infrastructure/config/AppConfig.test.js';
import './infrastructure/config/env.test.js';
import './infrastructure/container/Container.test.js';