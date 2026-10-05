-- États retirés de l'interface : les contacts concernés passent à l'état le plus proche.
UPDATE "Contact" SET "state" = 'lead_en_cours', "category" = 'lead' WHERE "state" IN ('free_trial', 'onboarding');
UPDATE "Contact" SET "state" = 'done', "category" = 'client' WHERE "state" = 'kickoff';
