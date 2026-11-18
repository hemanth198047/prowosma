package com.prowosma.backend.uma.ai;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** The deterministic owner rules that don't depend on the model. */
class InsightCommitmentRulesTest {
    static Map<Integer, InsightValidator.Line> line(String speaker, String text) { return Map.of(1, new InsightValidator.Line(1, speaker, text)); }

    @Test
    void aNamedSpeakerCommittingThemselvesOwnsIt() {
        assertThat(InsightValidator.selfCommitted(List.of(1), line("Anjali Mehta", "I'll prepare test cases after the API specs are final."))).isEqualTo("Anjali Mehta");
        assertThat(InsightValidator.selfCommitted(List.of(1), line("Priya Sharma", "I’ll take the frontend."))).isEqualTo("Priya Sharma");   // curly apostrophe
    }

    @Test
    void noOwnerFromNeutralOrUnknownSpeakers_orFromSomeoneElsesWords() {
        assertThat(InsightValidator.selfCommitted(List.of(1), line("Speaker 2", "I'll do it."))).isNull();
        assertThat(InsightValidator.selfCommitted(List.of(1), line("Speaker 1 (part 2)", "I will do it."))).isNull();
        assertThat(InsightValidator.selfCommitted(List.of(1), line(null, "I'll do it."))).isNull();
        assertThat(InsightValidator.selfCommitted(List.of(1), line("Ravi Kumar", "Suresh, please finish the APIs."))).isNull();
        assertThat(InsightValidator.selfCommitted(List.of(), line("Ravi Kumar", "I'll do it."))).isNull();
    }

    @Test
    void hedgedPromisesStayTentative() {
        assertThat(InsightValidator.hedged(List.of(1), line("Priya Sharma", "I'll share the designs tomorrow if I can."))).isTrue();
        assertThat(InsightValidator.hedged(List.of(1), line("Priya Sharma", "I'll try to finish it by Friday."))).isTrue();
        assertThat(InsightValidator.hedged(List.of(1), line("Priya Sharma", "Maybe I'll look at it."))).isTrue();
        assertThat(InsightValidator.hedged(List.of(1), line("Suresh Rao", "I'll implement the backend APIs by Thursday."))).isFalse();
    }
}
