-- Keep the Help Articles and AI retrieval text in sync with the Fuzed Flow contractor portal.
UPDATE public.help_faqs
SET answer_long = $article$## Before you begin
Open the project workspace and choose **Contractor Portal**. This subscriber-side area prepares a project bid package. It is separate from a subcontractor's Employee Portal account and from the general Help Articles portal.

Review exactly which documents and scope information should be shared outside your company. The portal's document list is controlled separately from your internal Quotes & Docs and Plans & Elevations catalogs.

## Prepare the package
1. Review **Scope of Work**. Choose its edit control, enter the intended scope, then save. The portal uses this scope field; a project's internal notes or quote scope are not necessarily the same text.
2. To add a new file, enter **New File Description (Optional)** and choose **Click to upload a brand new file**. Multiple files can be selected; wait for the upload/save result.
3. To reuse an existing file, choose **Share Existing Project Files**, select the appropriate documents or plans, and choose **Share to Portal**.
4. Inspect **Files Visible to Contractors**. Open the files to verify the correct version and check that no internal-only file was included.
5. Use **Copy** in the **Public Contractor Portal Link** card, then **Open** to inspect the package before sharing it with a recipient.
6. Review the Fuzed Flow branded outside portal and the submission instructions before sharing. Its quote-email action uses the project company’s configured business contact email. If that contact is unavailable, contractors should reply to the contact who sent their invitation. Include any additional bid instructions in your own message.

## Remove and update shared files
Use a file's remove control to take its record out of the portal list. An internal drawing revision does not automatically replace a separately shared portal record. Review the external list again after document changes.

## Troubleshooting and access
If a recipient sees **No project specified in the link**, copy the complete generated URL including its project identifier. **Project not found or link has expired** can also indicate access restrictions; contact your company administrator rather than bypassing permissions. File downloads may fall back to opening the document in a browser tab.

Copying the link does not send an invitation or confirm a bid submission. On a phone, use the full-width Copy/Open controls and scroll the shared-file list; verify the external package's scope, file names, and recipient instructions before sending it through your chosen channel.$article$,
    embedding = NULL,
    last_verified_at = DATE '2026-10-04'
WHERE slug = 'guide-project-contractor-portal';
