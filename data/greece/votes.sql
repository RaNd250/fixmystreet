-- 👍/👎 on reports (Greece cobrand: report/_support.html, votes.js, App::Controller::GreeceVote).
-- One vote per report and voter: "u:<user id>" for a signed-in voter, otherwise "c:" and the
-- SHA-256 of a random id kept in the voter's gr_voter cookie. The app connects as fms.
CREATE TABLE IF NOT EXISTS greece_vote (
    problem_id integer NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
    voter text NOT NULL,
    value smallint NOT NULL CHECK (value IN (-1, 1)),
    created timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (problem_id, voter)
);
ALTER TABLE greece_vote OWNER TO fms;
