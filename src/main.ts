import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/action'

import {cherryPickCommits} from 'github-cherry-pick'

import semver from 'semver'

/* 
  Hotfix procedure:
  gets the latest version of the action from the repo
  calculates the next patch version
  create a new branch from master if doesn't exist
  cherry-pick the commit from merged pull request
  push the branch to the repo
  create a new draft pull request from the branch to master if doesn't exist
*/

const octokit = new Octokit()

async function run(): Promise<void> {
  try {
    // gets the latest version of the action from the repo

    const {owner, repo} = github.context.repo
    const {pull_request} = github.context.payload

    if (!pull_request) {
      throw Error('Only pull_request events are supported.')
    }

    if (!pull_request.merged) {
      throw Error('Only merged pull requests are supported.')
    }

    core.debug(`Getting latest release from ${owner}/${repo}`)
    const {data: latestRelease} = await octokit.repos.getLatestRelease({
      owner,
      repo
    })

    core.debug(`Latest release: ${latestRelease.tag_name}`)

    // calculates the next patch version

    core.debug(`Calculating next patch version`)

    const releaseVersion = semver.inc(latestRelease.tag_name, 'patch')

    const releaseBranch = `release/${releaseVersion}`

    core.debug(`Next patch version: ${releaseVersion}`)
    core.debug(`Release branch: ${releaseBranch}`)

    // create a new branch from master if doesn't exist

    core.debug(`Checking if branch ${releaseBranch} exists`)

    try {
      await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${releaseBranch}`
      })
      core.debug(`Branch ${releaseBranch} exists`)
    } catch {
      core.debug(`Branch ${releaseBranch} doesn't exist`)
      core.debug(`Creating branch ${releaseBranch} from the latest release`)
      await octokit.git.createRef({
        owner,
        repo,
        ref: `heads/${releaseBranch}`,
        sha: latestRelease.target_commitish
      })
    }

    // cherry-pick the commit from merged pull request
    core.debug(
      `Cherry-picking pull_request ${pull_request.number} to ${releaseBranch}`
    )

    // merge_commit_sha

    await cherryPickCommits({
      commits: [pull_request.merge_commit_sha],
      head: releaseBranch,
      octokit,
      owner,
      repo
    })

    // create a new draft pull request from the branch to master if doesn't exist

    core.debug(`Creating pull request from ${releaseBranch} to master`)

    const pullRequest = await octokit.pulls.create({
      owner,
      repo,
      title: `Release ${releaseVersion}`,
      head: releaseBranch,
      base: 'master',
      draft: true
    })

    core.debug(`Pull request created: ${pullRequest.data.number}`)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
