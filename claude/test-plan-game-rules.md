# Card Game Rules Test Plan

## Overview
This document provides comprehensive test cases to validate all game rules, conditions, and business logic defined in the Card Game Dashboard. The test plan ensures game rule integrity and prevents breaking changes.

## Test Categories

### 1. Team Management Tests

#### 1.1 Team Creation Tests
| Test ID | Test Case | Expected Result | Validation Rule |
|---------|-----------|----------------|-----------------|
| TC_T001 | Create team with valid unique name | Team created successfully | Unique team names |
| TC_T002 | Create team with duplicate name (case-sensitive) | Error: Team name already exists | Case-insensitive uniqueness |
| TC_T003 | Create team with duplicate name (case-insensitive) | Error: Team name already exists | Case-insensitive uniqueness |
| TC_T004 | Create team with empty name | Error: Team name cannot be empty | Non-empty names |
| TC_T005 | Create team with whitespace-only name | Error: Team name cannot be empty | Non-empty names |
| TC_T006 | Create team with minimum 1 member | Team created successfully | Member requirements |
| TC_T007 | Create team with no members | Error: At least one member required | Member requirements |

#### 1.2 Team Statistics Tests
| Test ID | Test Case | Expected Result | Validation Rule |
|---------|-----------|----------------|-----------------|
| TC_T008 | Initial team stats are all zero | All stats = 0 | Default initialization |
| TC_T009 | Win rate calculation with 0 matches | Win rate = 0% | Division by zero handling |
| TC_T010 | Average score calculation with 0 matches | Average = 0 | Division by zero handling |
| TC_T011 | Round success rate with 0 rounds | Success rate = 0% | Division by zero handling |

### 2. Match Management Tests

#### 2.1 Match Creation Tests
| Test ID | Test Case | Expected Result | Validation Rule |
|---------|-----------|----------------|-----------------|
| TC_M001 | Create match between two different teams | Match created successfully | Distinct teams |
| TC_M002 | Create match with same team twice | Error: Teams must be different | Distinct teams |
| TC_M003 | Create second pending match between same teams | Error: Duplicate pending match | No duplicate pending matches |
| TC_M004 | Create match with non-existent team | Error: Invalid team | Team existence validation |

#### 2.2 Match State Transition Tests
| Test ID | Test Case | Expected Result | Validation Rule |
|---------|-----------|----------------|-----------------|
| TC_M005 | Start pending match | Status changes to in_progress | State progression |
| TC_M006 | Start already started match | Error: Match already in progress | State progression |
| TC_M007 | Cancel pending match | Status changes to cancelled | State progression |
| TC_M008 | Cancel in_progress match | Status changes to cancelled | State progression |
| TC_M009 | Complete match when team reaches 500 | Status changes to completed | Automatic completion |
| TC_M010 | Try to modify completed match | Error: Match is completed | State progression |

### 3. Round Management Tests

#### 3.1 Promise Hand Validation Tests
| Test ID | Test Case | Input | Expected Result | Validation Rule |
|---------|-----------|-------|----------------|-----------------|
| TC_R001 | Valid promise hands | T1: 4, T2: 13 | Round accepted | 4 ≤ promise ≤ 13 |
| TC_R002 | Valid promise hands | T1: 7, T2: 8 | Round accepted | 4 ≤ promise ≤ 13 |
| TC_R003 | Team 1 promise below minimum | T1: 3, T2: 8 | Error: Promise must be 4-13 | Promise range validation |
| TC_R004 | Team 1 promise above maximum | T1: 14, T2: 8 | Error: Promise must be 4-13 | Promise range validation |
| TC_R005 | Team 2 promise below minimum | T1: 8, T2: 3 | Error: Promise must be 4-13 | Promise range validation |
| TC_R006 | Team 2 promise above maximum | T1: 8, T2: 14 | Error: Promise must be 4-13 | Promise range validation |
| TC_R007 | Both promises at minimum | T1: 4, T2: 4 | Round accepted | Boundary testing |
| TC_R008 | Both promises at maximum | T1: 13, T2: 13 | Round accepted | Boundary testing |

#### 3.2 Actual Hand Validation Tests
| Test ID | Test Case | Input | Expected Result | Validation Rule |
|---------|-----------|-------|----------------|-----------------|
| TC_R009 | Valid actual hands summing to 13 | T1: 6, T2: 7 | Round accepted | Sum must equal 13 |
| TC_R010 | Valid actual hands summing to 13 | T1: 0, T2: 13 | Round accepted | Sum must equal 13 |
| TC_R011 | Valid actual hands summing to 13 | T1: 13, T2: 0 | Round accepted | Sum must equal 13 |
| TC_R012 | Actual hands summing to less than 13 | T1: 5, T2: 7 | Error: Sum must equal 13 | Sum validation |
| TC_R013 | Actual hands summing to more than 13 | T1: 7, T2: 7 | Error: Sum must equal 13 | Sum validation |
| TC_R014 | Negative actual hands | T1: -1, T2: 14 | Error: Negative hands not allowed | Non-negative validation |

#### 3.3 Round Addition Tests
| Test ID | Test Case | Expected Result | Validation Rule |
|---------|-----------|----------------|-----------------|
| TC_R015 | Add round to pending match | Error: Match not started | Match status check |
| TC_R016 | Add round to in_progress match | Round added successfully | Status validation |
| TC_R017 | Add round to completed match | Error: Match is completed | Status validation |
| TC_R018 | Add round to cancelled match | Error: Match is cancelled | Status validation |

### 4. Scoring System Tests

#### 4.1 Score Calculation Tests
| Test ID | Test Case | Promise | Actual | Expected Score | Validation |
|---------|-----------|---------|--------|----------------|------------|
| TC_S001 | Perfect promise match | 6 | 6 | 0 | |6-6| × 10 = 0 |
| TC_S002 | Promise higher than actual | 8 | 5 | 30 | |8-5| × 10 = 30 |
| TC_S003 | Promise lower than actual | 4 | 9 | 50 | |4-9| × 10 = 50 |
| TC_S004 | Maximum difference | 4 | 13 | 90 | |4-13| × 10 = 90 |
| TC_S005 | Minimum promise, minimum actual | 4 | 0 | 40 | |4-0| × 10 = 40 |
| TC_S006 | Maximum promise, maximum actual | 13 | 13 | 0 | |13-13| × 10 = 0 |

#### 4.2 Score Boundary Tests
| Test ID | Test Case | T1 Score | T2 Score | Expected Result | Validation Rule |
|---------|-----------|----------|----------|----------------|-----------------|
| TC_S007 | Total score at upper limit | 100 | 100 | Round accepted | Total ≤ 200 |
| TC_S008 | Total score above upper limit | 110 | 100 | Error: Score > 200 | Score boundaries |
| TC_S009 | Total score at lower limit | -50 | -50 | Round accepted | Total ≥ -100 |
| TC_S010 | Total score below lower limit | -60 | -50 | Error: Score < -100 | Score boundaries |
| TC_S011 | Valid score range | 30 | 20 | Round accepted | Within boundaries |

### 5. Win Condition Tests

#### 5.1 Match Completion Tests
| Test ID | Test Case | T1 Score | T2 Score | Expected Result | Validation |
|---------|-----------|----------|----------|----------------|------------|
| TC_W001 | Team 1 reaches exactly 500 | 500 | 450 | Team 1 wins, match completes | Win threshold |
| TC_W002 | Team 2 reaches exactly 500 | 450 | 500 | Team 2 wins, match completes | Win threshold |
| TC_W003 | Team 1 exceeds 500 | 520 | 450 | Team 1 wins, match completes | Win threshold |
| TC_W004 | Both teams reach 500 simultaneously | 505 | 523 | Higher score (Team 2) wins | Simultaneous handling |
| TC_W004b | Both reach 500 with equal totals | 510 | 510 | Team 1 wins (exact-tie fallback) | Simultaneous tie-break |
| TC_W005 | Score just below 500 | 499 | 450 | Match continues | Threshold enforcement |

#### 5.2 Round Win/Loss Tracking
| Test ID | Test Case | T1 Round Score | T2 Round Score | T1 Rounds Won | T2 Rounds Won |
|---------|-----------|----------------|----------------|---------------|---------------|
| TC_W006 | Team 1 wins round | 10 | 20 | +1 | 0 |
| TC_W007 | Team 2 wins round | 30 | 10 | 0 | +1 |
| TC_W008 | Tied round scores | 20 | 20 | 0 | 0 |

### 6. Statistics and Analytics Tests

#### 6.1 Team Statistics Updates
| Test ID | Test Case | Expected Update | Validation |
|---------|-----------|----------------|------------|
| TC_ST001 | Match completion updates wins/losses | Winner +1 win, Loser +1 loss | Statistics accuracy |
| TC_ST002 | Points awarded correctly | Winner +3 points, Loser +0 points | League points |
| TC_ST003 | Total score accumulation | Team total score updated | Score tracking |
| TC_ST004 | Round statistics updates | Rounds won/lost updated | Round tracking |
| TC_ST005 | Matches played increment | Both teams +1 matches played | Match counting |

#### 6.2 Head-to-Head Statistics
| Test ID | Test Case | Expected Result | Validation |
|---------|-----------|----------------|------------|
| TC_ST006 | H2H record creation | New H2H record between teams | H2H initialization |
| TC_ST007 | H2H wins/losses update | Correct H2H record updates | H2H accuracy |
| TC_ST008 | H2H average scores | Correct H2H score averages | H2H calculations |

#### 6.3 Recent Form Tracking
| Test ID | Test Case | Expected Result | Validation |
|---------|-----------|----------------|------------|
| TC_ST009 | First 5 matches form | Correct form string (W/L/D) | Form tracking |
| TC_ST010 | Form after 6th match | Oldest match dropped | Form window |
| TC_ST011 | Form display order | Most recent first | Form ordering |

### 7. Data Integrity Tests

#### 7.1 Input Sanitization
| Test ID | Test Case | Input | Expected Result | Validation |
|---------|-----------|-------|----------------|------------|
| TC_DI001 | SQL injection in team name | `'; DROP TABLE teams; --` | Name sanitized/rejected | Security |
| TC_DI002 | XSS in team name | `<script>alert('xss')</script>` | Name sanitized | Security |
| TC_DI003 | Very long team name | 1000+ character string | Name truncated/rejected | Length limits |
| TC_DI004 | Unicode characters in name | Special unicode chars | Proper handling | Character encoding |

#### 7.2 Concurrent Access Tests
| Test ID | Test Case | Expected Result | Validation |
|---------|-----------|----------------|------------|
| TC_DI005 | Simultaneous round additions | One succeeds, others rejected | Concurrency |
| TC_DI006 | Simultaneous match completions | Consistent final state | Race conditions |
| TC_DI007 | Simultaneous team creation | Unique names enforced | Uniqueness |

### 8. Edge Cases and Error Handling

#### 8.1 Boundary Conditions
| Test ID | Test Case | Input | Expected Behavior |
|---------|-----------|-------|------------------|
| TC_E001 | Maximum integer values | Very large numbers | Graceful handling |
| TC_E002 | Floating point precision | Decimal inputs | Proper rounding |
| TC_E003 | Empty/null inputs | null/undefined values | Error handling |
| TC_E004 | Special characters | Various symbols | Proper validation |

#### 8.2 System Limits
| Test ID | Test Case | Expected Behavior | Validation |
|---------|-----------|------------------|------------|
| TC_E005 | Maximum teams creation | System limit handling | Resource management |
| TC_E006 | Maximum matches per team | Limit enforcement | Performance |
| TC_E007 | Maximum rounds per match | Memory/performance limits | Scalability |

### 9. User Experience Tests

#### 9.1 Error Messages
| Test ID | Test Case | Expected Error Message | User Clarity |
|---------|-----------|----------------------|--------------|
| TC_UX001 | Invalid promise range | "Promise must be between 4 and 13" | Clear guidance |
| TC_UX002 | Invalid actual sum | "Actual hands must sum to 13" | Specific requirement |
| TC_UX003 | Duplicate team name | "Team name already exists" | Clear conflict |
| TC_UX004 | Match completion | "Team X wins! Match completed" | Success feedback |

#### 9.2 Validation Feedback
| Test ID | Test Case | Expected Feedback | Validation |
|---------|-----------|------------------|------------|
| TC_UX005 | Real-time validation | Immediate error display | User experience |
| TC_UX006 | Form submission | Clear success/error states | Feedback clarity |
| TC_UX007 | Loading states | Progress indicators | User awareness |

## Test Execution Guidelines

### Prerequisites
1. Clean database/storage state
2. Valid test data sets
3. Authentication setup for admin actions
4. Browser/environment compatibility

### Test Data Sets
```javascript
// Valid Teams
const validTeams = [
    { name: "Team Alpha", members: ["Player 1", "Player 2"] },
    { name: "Team Beta", members: ["Player 3", "Player 4"] }
];

// Valid Promise/Actual Combinations
const validRounds = [
    { t1Promise: 4, t2Promise: 9, t1Actual: 6, t2Actual: 7 },
    { t1Promise: 8, t2Promise: 5, t1Actual: 0, t2Actual: 13 },
    { t1Promise: 13, t2Promise: 4, t1Actual: 13, t2Actual: 0 }
];

// Boundary Test Cases
const boundaryTests = [
    { promises: [4, 13], actuals: [0, 13] },
    { promises: [13, 4], actuals: [13, 0] },
    { promises: [3, 14], actuals: [-1, 14] } // Invalid cases
];
```

### Automated Test Implementation
```javascript
// Example test structure
describe('Game Rules Validation', () => {
    beforeEach(() => {
        // Setup clean test environment
    });
    
    describe('Promise Hand Validation', () => {
        test('TC_R001: Valid promise hands accepted', () => {
            // Test implementation
        });
        
        test('TC_R003: Below minimum promise rejected', () => {
            // Test implementation
        });
    });
});
```

## Coverage Analysis

### Rule Coverage Matrix
| Rule Category | Test Cases | Coverage % | Critical Tests |
|---------------|------------|------------|----------------|
| Team Management | TC_T001-T011 | 100% | TC_T002, TC_T003 |
| Match Lifecycle | TC_M001-M010 | 100% | TC_M002, TC_M009 |
| Promise Validation | TC_R001-R008 | 100% | TC_R003-R006 |
| Actual Validation | TC_R009-R014 | 100% | TC_R012, TC_R014 |
| Scoring Logic | TC_S001-S011 | 100% | TC_S008, TC_S010 |
| Win Conditions | TC_W001-W008 | 100% | TC_W001-W004 |
| Statistics | TC_ST001-ST011 | 100% | TC_ST001, TC_ST002 |
| Data Integrity | TC_DI001-DI007 | 90% | TC_DI001, TC_DI002 |
| Edge Cases | TC_E001-E007 | 85% | TC_E001, TC_E005 |
| User Experience | TC_UX001-UX007 | 95% | TC_UX001-UX004 |

## Missing Test Scenarios (Recommendations)

### 1. Performance Tests
- **Load Testing**: Multiple concurrent matches
- **Stress Testing**: Maximum data volumes
- **Memory Usage**: Long-running match scenarios

### 2. Integration Tests
- **Database Persistence**: Data consistency across sessions
- **API Integration**: Full request/response validation
- **Authentication**: Role-based access control

### 3. Recovery Scenarios
- **Data Corruption**: Invalid data recovery
- **Network Failures**: Offline/online state handling
- **Browser Crashes**: State persistence and recovery

### 4. Advanced Game Scenarios
- **Tournament Mode**: Multi-match sequences
- **Handicap Systems**: Score adjustments
- **Time Limits**: Match duration constraints

### 5. Accessibility Tests
- **Screen Readers**: Game state communication
- **Keyboard Navigation**: Full keyboard accessibility
- **Visual Indicators**: Color-blind friendly design

### 6. Cross-Platform Tests
- **Mobile Browsers**: Touch interface validation
- **Different Screen Sizes**: Responsive design
- **Browser Compatibility**: Cross-browser functionality

## Test Automation Strategy

### Unit Test Priority
1. **Critical Path**: Core game logic (TC_R001-R014, TC_S001-S011)
2. **Business Rules**: Match and team validations (TC_M001-M010, TC_T001-T007)
3. **Edge Cases**: Boundary conditions (TC_E001-E007)

### Integration Test Priority
1. **End-to-End Game Flow**: Complete match lifecycle
2. **Statistics Accuracy**: Cross-match data consistency
3. **User Workflows**: Complete user journeys

### Manual Test Priority
1. **User Experience**: Error messages and feedback
2. **Visual Validation**: UI state consistency
3. **Exploratory Testing**: Unexpected user behaviors

## Success Criteria
- **100% rule coverage**: All game rules have corresponding tests
- **95% pass rate**: No more than 5% test failures acceptable
- **Performance benchmarks**: Response times under acceptable limits
- **Zero critical bugs**: No rule-breaking issues in production

This comprehensive test plan ensures your card game rules remain intact and functional across all scenarios and edge cases.