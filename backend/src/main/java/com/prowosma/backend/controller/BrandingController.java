package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.WorkspaceRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/workspaces")
@Tag(name = "Branding", description = "White-label and brand customisation")
@RequiredArgsConstructor
public class BrandingController {

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceContext    workspaceContext;

    /** GET /api/workspaces/branding — returns all branding fields for active workspace */
    @GetMapping("/branding")
    public ResponseEntity<Map<String, Object>> getBranding() {
        String wsId = workspaceContext.getWorkspaceId();
        return workspaceRepository.findById(wsId).map(ws -> {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("appName",                 ws.getBrandName()           != null ? ws.getBrandName()           : "");
            b.put("logoUrl",                 ws.getBrandLogoUrl()        != null ? ws.getBrandLogoUrl()        : "");
            b.put("faviconUrl",              ws.getBrandFaviconUrl()     != null ? ws.getBrandFaviconUrl()     : "");
            b.put("primaryColor",            ws.getBrandPrimaryColor()   != null ? ws.getBrandPrimaryColor()   : "#4f46e5");
            b.put("sidebarColor",            ws.getBrandSidebarColor()   != null ? ws.getBrandSidebarColor()   : "");
            b.put("topbarColor",             ws.getBrandTopbarColor()    != null ? ws.getBrandTopbarColor()    : "#ffffff");
            b.put("footerText",              ws.getBrandFooterText()     != null ? ws.getBrandFooterText()     : "");
            b.put("customDomain",            ws.getCustomDomain()        != null ? ws.getCustomDomain()        : "");
            b.put("removeProwosmaBranding", ws.isRemoveProwosmaBranding());
            b.put("customEmailSender",       ws.getBrandEmailSender()    != null ? ws.getBrandEmailSender()    : "");
            b.put("customEmailDomain",       ws.getBrandEmailDomain()    != null ? ws.getBrandEmailDomain()    : "");
            b.put("loginBackgroundUrl",      ws.getBrandLoginBg()        != null ? ws.getBrandLoginBg()        : "");
            b.put("loginTitle",              ws.getBrandLoginTitle()     != null ? ws.getBrandLoginTitle()     : "");
            b.put("loginSubtitle",           ws.getBrandLoginSubtitle()  != null ? ws.getBrandLoginSubtitle()  : "");
            b.put("supportEmail",            ws.getBrandSupportEmail()   != null ? ws.getBrandSupportEmail()   : "");
            b.put("helpUrl",                 ws.getBrandHelpUrl()        != null ? ws.getBrandHelpUrl()        : "");
            b.put("privacyUrl",              ws.getBrandPrivacyUrl()     != null ? ws.getBrandPrivacyUrl()     : "");
            b.put("termsUrl",                ws.getBrandTermsUrl()       != null ? ws.getBrandTermsUrl()       : "");
            b.put("customCss",               ws.getBrandCustomCss()      != null ? ws.getBrandCustomCss()      : "");
            b.put("customJs",                ws.getBrandCustomJs()       != null ? ws.getBrandCustomJs()       : "");
            b.put("pdfLogoUrl",              ws.getBrandPdfLogoUrl()     != null ? ws.getBrandPdfLogoUrl()     : "");
            b.put("pdfColor",                ws.getBrandPdfColor()       != null ? ws.getBrandPdfColor()       : "");
            b.put("pdfFooter",               ws.getBrandPdfFooter()      != null ? ws.getBrandPdfFooter()      : "");
            return ResponseEntity.ok(b);
        }).orElse(ResponseEntity.notFound().build());
    }

    /** PUT /api/workspaces/branding — save all branding fields */
    @PutMapping("/branding")
    public ResponseEntity<Map<String, String>> saveBranding(
            @RequestBody Map<String, Object> body) {
        String wsId = workspaceContext.getWorkspaceId();
        return workspaceRepository.findById(wsId).map(ws -> {
            if (body.containsKey("appName"))           ws.setBrandName((String) body.get("appName"));
            if (body.containsKey("logoUrl"))           ws.setBrandLogoUrl((String) body.get("logoUrl"));
            if (body.containsKey("faviconUrl"))        ws.setBrandFaviconUrl((String) body.get("faviconUrl"));
            if (body.containsKey("primaryColor"))      ws.setBrandPrimaryColor((String) body.get("primaryColor"));
            if (body.containsKey("sidebarColor"))      ws.setBrandSidebarColor((String) body.get("sidebarColor"));
            if (body.containsKey("topbarColor"))       ws.setBrandTopbarColor((String) body.get("topbarColor"));
            if (body.containsKey("footerText"))        ws.setBrandFooterText((String) body.get("footerText"));
            if (body.containsKey("customDomain"))      ws.setCustomDomain((String) body.get("customDomain"));
            if (body.containsKey("removeProwosmaBranding"))
                ws.setRemoveProwosmaBranding(Boolean.TRUE.equals(body.get("removeProwosmaBranding")));
            if (body.containsKey("customEmailSender")) ws.setBrandEmailSender((String) body.get("customEmailSender"));
            if (body.containsKey("customEmailDomain")) ws.setBrandEmailDomain((String) body.get("customEmailDomain"));
            if (body.containsKey("loginBackgroundUrl"))ws.setBrandLoginBg((String) body.get("loginBackgroundUrl"));
            if (body.containsKey("loginTitle"))        ws.setBrandLoginTitle((String) body.get("loginTitle"));
            if (body.containsKey("loginSubtitle"))     ws.setBrandLoginSubtitle((String) body.get("loginSubtitle"));
            if (body.containsKey("supportEmail"))      ws.setBrandSupportEmail((String) body.get("supportEmail"));
            if (body.containsKey("helpUrl"))           ws.setBrandHelpUrl((String) body.get("helpUrl"));
            if (body.containsKey("privacyUrl"))        ws.setBrandPrivacyUrl((String) body.get("privacyUrl"));
            if (body.containsKey("termsUrl"))          ws.setBrandTermsUrl((String) body.get("termsUrl"));
            if (body.containsKey("customCss"))         ws.setBrandCustomCss((String) body.get("customCss"));
            if (body.containsKey("customJs"))          ws.setBrandCustomJs((String) body.get("customJs"));
            if (body.containsKey("pdfLogoUrl"))        ws.setBrandPdfLogoUrl((String) body.get("pdfLogoUrl"));
            if (body.containsKey("pdfColor"))          ws.setBrandPdfColor((String) body.get("pdfColor"));
            if (body.containsKey("pdfFooter"))         ws.setBrandPdfFooter((String) body.get("pdfFooter"));
            workspaceRepository.save(ws);
            return ResponseEntity.ok(Map.of("message", "Branding saved"));
        }).orElse(ResponseEntity.notFound().build());
    }
}
