package com.prowosma.backend.config;

import io.swagger.v3.oas.models.ExternalDocumentation;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.servers.Server;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class SwaggerConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        Server localServer = new Server();
        localServer.setUrl("http://localhost:9090");
        localServer.setDescription("Products N Goals Development Area");

        Contact contact = new Contact();
        contact.setName("Hemanth Kumar K");
        contact.setEmail("java.swing.developer@gmail.com");

        License license = new License()
                .name("Apache 2.0")
                .url("http://www.apache.org/licenses/LICENSE-2.0.html");

        Info info = new Info()
                .title("Prowosma APIs")
                .version("1.0")
                .description("API documentation for Prowosma backend")
                .contact(contact)
                .license(license);

        return new OpenAPI()
                .info(info)
                .servers(List.of(localServer))
                .externalDocs(
                        new ExternalDocumentation()
                                .description("Project Wiki")
                                .url("https://www.abhixo.com")
                );
    }

    @Bean
    public GroupedOpenApi projectsApi() {
        return GroupedOpenApi.builder()
                .group("Projects")
                .pathsToMatch("/api/projects/**")
                .build();
    }

    @Bean
    public GroupedOpenApi tasksApi() {
        return GroupedOpenApi.builder()
                .group("Tasks")
                .pathsToMatch("/api/tasks/**")
                .build();
    }

    @Bean
    public GroupedOpenApi goalsApi() {
        return GroupedOpenApi.builder()
                .group("Goals")
                .pathsToMatch("/api/goals/**")
                .build();
    }

    @Bean
    public GroupedOpenApi dashboardApi() {
        return GroupedOpenApi.builder()
                .group("Dashboard")
                .pathsToMatch("/api/dashboard/**")
                .build();
    }

    @Bean
    public GroupedOpenApi categoriesApi() {
        return GroupedOpenApi.builder()
                .group("Categories")
                .pathsToMatch("/api/categories/**")
                .build();
    }
    @Bean
    public GroupedOpenApi remindersApi() {
        return GroupedOpenApi.builder()
                .group("Reminders")
                .pathsToMatch("/api/reminders/**")
                .build();
    }

    @Bean
    public GroupedOpenApi projectProgressApi() {
        return GroupedOpenApi.builder()
                .group("Project Progress")
                .pathsToMatch("/api/projects/{id}/progress", "/api/projects/{id}/subprojects")
                .build();
    }

    @Bean
    public GroupedOpenApi generalApi() {
        return GroupedOpenApi.builder()
                .group("General APIs")
                .pathsToMatch("/api", "/api")
                .build();
    }

    @Bean
    public GroupedOpenApi invitationsApi() {
        return GroupedOpenApi.builder()
                .group("Invitation APIs")
                .pathsToMatch("/api/invitations", "/api/invitations")
                .build();
    }
}

