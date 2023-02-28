import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/action'

import {cherryPickCommits} from 'github-cherry-pick'

import semver from 'semver'

/* 
  Hotfix procedure:
  gets the latest version of the action from the repo
  calculates the next patch version
  create a new branch from main if doesn't exist
  cherry-pick the commit from merged pull request
  push the branch to the repo
  create a new draft pull request from the branch to main if doesn't exist
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
    // TODO: improve prefix handling (e.g. v1.0.0) and coercion (e.g. 1.0.0-alpha.1)
    const releaseVersion = semver.inc(latestRelease.tag_name, 'patch')

    const releaseBranch = `release-${releaseVersion}`

    core.debug(`Next patch version: ${releaseVersion}`)
    core.debug(`Release branch: ${releaseBranch}`)

    // gets the sha of the latest release

    core.debug(`Getting sha of the latest release`)

    const {data: latestReleaseCommit} = await octokit.git.getRef({
      owner,
      repo,
      ref: `tags/${latestRelease.tag_name}`
    })

    core.debug(`Latest release sha: ${latestReleaseCommit.object.sha}`)

    // create a new branch from main if doesn't exist

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
        ref: `refs/heads/${releaseBranch}`,
        sha: latestReleaseCommit.object.sha
      })
    }

    // cherry-pick the commit from merged pull request
    core.debug(
      `Cherry-picking pull_request ${pull_request.number} to ${releaseBranch} sha: ${pull_request.merge_commit_sha}`
    )

    // merge_commit_sha

    try {
      await cherryPickCommits({
        commits: [pull_request.merge_commit_sha],
        head: releaseBranch,
        octokit,
        owner,
        repo
      })
    } catch (error) {
      // create a pull trying to merge the cherry-picked commit to the release branch

      const mergedBranch = `${releaseBranch}-${pull_request.number}-conflict`

      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${mergedBranch}}`,
        sha: pull_request.merge_commit_sha
      })

      // merge conflict message

      await octokit.rest.issues.createComment({
        ...github.context.repo,
        issue_number: pull_request.number,
        body: `There was a merge conflict when cherry-picking the commit \`#${pull_request.merge_commit_sha}\` to the release branch \`${releaseBranch}\`. 
        Please resolve the merge conflict and push the branch to the repo.
        \`\`\`
        
        git checkout ${mergedBranch}
        git merge ${releaseBranch}
        // resolve merge conflict
        git push origin ${mergedBranch}

        \`\`\`
        `
      })
    }

    // create a new draft pull request from the branch to main if doesn't exist

    core.debug(`Creating pull request from ${releaseBranch} to main`)

    const pullRequest = await octokit.pulls.create({
      owner,
      repo,
      title: `Release ${releaseVersion}`,
      head: releaseBranch,
      base: 'main',
      draft: true
    })

    core.debug(`Pull request created: ${pullRequest.data.number}`)
  } catch (error) {
    if (error instanceof Error) core.setFailed(JSON.stringify(error))
  }
}

run()
