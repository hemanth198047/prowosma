package com.prowosma.backend.channels;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Channel;
import com.prowosma.backend.model.ChannelMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.data.mongodb.core.query.Query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Private channels and direct messages: only their members see them - not even the workspace owner. */
class PrivateChannelsTest extends ProwosmaTestBase {
    final ObjectMapper om = new ObjectMapper();

    @BeforeEach
    void clean() { mongoTemplate.remove(new Query(), Channel.class); mongoTemplate.remove(new Query(), ChannelMessage.class); }

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON);
    }
    MvcResult call(MockHttpServletRequestBuilder b, String token, String body) throws Exception {
        return mvc.perform(as(b, token).content(body == null ? "" : body)).andReturn();
    }
    JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }
    String names(String token) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (JsonNode c : json(call(get("/api/channels"), token, null)).path("data")) sb.append(c.get("name").asText()).append(';');
        return sb.toString();
    }

    @Test
    void aPrivateChannelIsOnlyForItsMembers() throws Exception {
        MvcResult made = call(post("/api/channels"), adminToken(), "{\"name\":\"#editors\",\"visibility\":\"PRIVATE\",\"type\":\"TEAM\",\"memberEmails\":[\"member@test.com\"]}");
        assertThat(made.getResponse().getStatus()).as(made.getResponse().getContentAsString()).isEqualTo(200);
        String id = json(made).get("id").asText();
        assertThat(json(made).get("name").asText()).isEqualTo("editors");
        call(post("/api/channels"), adminToken(), "{\"name\":\"general\",\"type\":\"TEAM\"}");

        // members see it and talk in it
        assertThat(names(memberToken())).contains("editors").contains("general");
        assertThat(call(post("/api/channels/" + id + "/messages"), memberToken(), "{\"content\":\"hi editors\"}").getResponse().getStatus()).isEqualTo(200);
        JsonNode msgs = json(call(get("/api/channels/" + id + "/messages"), adminToken(), null)).path("data");
        assertThat(msgs.get(0).get("authorName").asText()).isEqualTo("Test Member");

        // the workspace owner isn't a member: can't list, read, post or delete it
        assertThat(names(ownerToken())).doesNotContain("editors").contains("general");
        assertThat(call(get("/api/channels/" + id + "/messages"), ownerToken(), null).getResponse().getStatus()).isEqualTo(404);
        assertThat(call(post("/api/channels/" + id + "/messages"), ownerToken(), "{\"content\":\"x\"}").getResponse().getStatus()).isEqualTo(404);
        assertThat(call(delete("/api/channels/" + id), ownerToken(), null).getResponse().getStatus()).isEqualTo(404);

        // a plain member can't add people; the owner of the channel can, and only workspace people
        assertThat(call(post("/api/channels/" + id + "/members"), memberToken(), "{\"emails\":[\"owner@test.com\"]}").getResponse().getStatus()).isEqualTo(403);
        assertThat(call(post("/api/channels/" + id + "/members"), adminToken(), "{\"emails\":[\"stranger@else.com\"]}").getResponse().getStatus()).isEqualTo(400);
        assertThat(call(post("/api/channels/" + id + "/members"), adminToken(), "{\"emails\":[\"owner@test.com\"]}").getResponse().getStatus()).isEqualTo(200);
        assertThat(names(ownerToken())).contains("editors");

        // leaving: the member removes themselves and loses access
        assertThat(call(delete("/api/channels/" + id + "/members/member@test.com"), memberToken(), null).getResponse().getStatus()).isEqualTo(200);
        assertThat(names(memberToken())).doesNotContain("editors");
    }

    @Test
    void directMessagesAreBetweenTwoPeople_andReused() throws Exception {
        MvcResult a = call(post("/api/channels/dm"), memberToken(), "{\"email\":\"admin@test.com\"}");
        assertThat(a.getResponse().getStatus()).as(a.getResponse().getContentAsString()).isEqualTo(200);
        String id = json(a).get("id").asText();
        assertThat(json(a).get("type").asText()).isEqualTo("DM");
        // the other person opening it gets the same conversation
        assertThat(json(call(post("/api/channels/dm"), adminToken(), "{\"email\":\"MEMBER@test.com\"}")).get("id").asText()).isEqualTo(id);
        assertThat(call(get("/api/channels/" + id + "/messages"), ownerToken(), null).getResponse().getStatus()).isEqualTo(404);
        assertThat(call(post("/api/channels/dm"), memberToken(), "{\"email\":\"member@test.com\"}").getResponse().getStatus()).isEqualTo(400);
        assertThat(call(post("/api/channels/" + id + "/members"), memberToken(), "{\"emails\":[\"owner@test.com\"]}").getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void thePeoplePickerListsWorkspacePeople() throws Exception {
        JsonNode p = json(call(get("/api/channels/people"), memberToken(), null));
        assertThat(p.toString()).contains("member@test.com").contains("admin@test.com").contains("owner@test.com");
    }
}
