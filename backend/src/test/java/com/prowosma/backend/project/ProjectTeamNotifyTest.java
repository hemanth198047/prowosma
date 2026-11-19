package com.prowosma.backend.project;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Notification;
import com.prowosma.backend.model.Project;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/** Picking people for a project tells the ones who were just added - once, and not the person adding them. */
class ProjectTeamNotifyTest extends ProwosmaTestBase {

    @Test
    void newlyAddedPeopleAreTold_once() throws Exception {
        mongoTemplate.remove(new Query(), Notification.class);
        Project p = new Project();
        p.setOrganizationId(workspaceId); p.setName("Wedding film"); p.setCreatedBy(ownerEmail);
        String id = mongoTemplate.save(p).getId();

        String body = "{\"members\":[{\"email\":\"member@test.com\"},{\"email\":\"owner@test.com\"}]}";
        int status = mvc.perform(put("/api/projects/" + id + "/team").header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getStatus();
        assertThat(status).isEqualTo(200);
        // again with one more person: only the new one is told
        mvc.perform(put("/api/projects/" + id + "/team").header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"members\":[{\"email\":\"member@test.com\"},{\"email\":\"owner@test.com\"},{\"email\":\"admin@test.com\"}]}")).andReturn();

        List<Notification> told = mongoTemplate.find(new Query(Criteria.where("entityId").is(id).and("category").is("ASSIGNMENT")), Notification.class);
        assertThat(told).extracting(Notification::getMessage)
                .containsExactlyInAnyOrder("member@test.com was added to Wedding film", "admin@test.com was added to Wedding film");
    }
}
