import passport from 'passport';
import Nodemailer from 'nodemailer';
import md5 from 'spark-md5';
import User from '../models/user';
import VerificationToken from '../models/verificationToken';
import PasswordResetToken from '../models/passwordResetToken';
import * as constants from '../../../constants';

export function login( req, res, next ) {

  passport.authenticate( 'local', (authErr, user, info) => {
    if ( authErr ) {
      return res.status( 401 ).json( {
        response: constants.RESPONSE_LOG_IN_NOT_FOUND
      } );
    }
    if ( !user ) {
      return res.status( 401 ).json( {
        response: constants.RESPONSE_LOG_IN_NOT_FOUND
      } );
    }

    return req.logIn( user, (loginErr) => {
      if ( loginErr ) {
        return res.status( 401 ).json( {
          response: constants.RESPONSE_LOG_IN_FAILURE
        } );
      }
      if ( !user.verified ) {
        return res.status( 200 ).json( {
          response: constants.RESPONSE_LOG_IN_EMAIL_NOT_VERIFIED,
          email: user.email
        } );
      }
      return res.status( 200 ).json( {
        response: constants.RESPONSE_LOG_IN_SUCCESS,
        email: user.email
      } );
    } );
  } )( req, res, next );
}


export function logout( req, res ) {
  req.logout();
  res.redirect( '/' );
}

export function isEmailAddressAvailable( req, res, next ) {
  User.findOne( {
    email: req.params.emailaddress
  }, (findErr, existingUser) => {
    if ( existingUser ) {
      return res.status( 409 ).json( {
      } );
    }
    return res.status( 200 ).json( {
    } );
  } );
}


export function register( req, res, next ) {
  const user = new User( {
    email: req.body.email,
    password: req.body.password
  } );

  User.findOne( {
    email: req.body.email
  }, (findErr, existingUser) => {
    if ( existingUser ) {
      return res.status( 409 ).json( {
        response: constants.RESPONSE_REGISTER_CONFLICT,
      } );
    }

    user.save( (saveErr) => {
      if ( saveErr ) {
        return res.status( 409 ).json( {
          response: constants.RESPONSE_REGISTER_FAILURE,
        } );
      }
      return req.logIn( user, (loginErr) => {
        if ( loginErr ) {
          return res.status( 409 ).json( {
            response: constants.RESPONSE_LOG_IN_FAILURE,
          } );
        }
        return res.status( 200 ).json( {
          response: constants.RESPONSE_LOG_IN_SUCCESS
        } );
      } );
    } );
  } );
}

export function dbVerify( req, res ) {
  const token = req.body.token;
  VerificationToken.findOne( {
    token: token
  }, function ( err, token ) {
    if ( err || !token ) {
      return res.status( 401 ).json( {
        response: constants.RESPONSE_VERIFY_INVALID_VERIFICATION_TOKEN
      } );
    }
    User.findOne( {
      email: token.email
    }, function ( err, user ) {
      if ( err || !user ) {
        return res.status( 401 ).json( {
          response: constants.RESPONSE_VERIFY_FAILURE
        } );
      }
      user[ "verified" ] = true;
      user.save( function ( err ) {

        return req.logIn( user, (loginErr) => {
          if ( loginErr )
            return res.status( 401 ).json( {
              message: loginErr
            } );
          return res.status( 200 ).json( {
            response: constants.RESPONSE_VERIFY_SUCCESS,
            email: user.email
          } );
        } );
      } );
    } );
  } );
}

function sendEmail( to, subject, text, html, callback ) {
  let transporter = Nodemailer.createTransport( {
    service: 'Postmark',
    auth: {
      user: process.env.POSTMARK_API_TOKEN,
      pass: process.env.POSTMARK_API_TOKEN
    }
  } );
  let mailOptions = {
    from: '"Portfolio Rebalancer" <noreply@portfoliorebalancer.com>',
    to,
    subject,
    text,
    html
  };
  return transporter.sendMail( mailOptions, (error, info) => {
    if ( error ) {
      console.log( "Failed to send email to ", to );
      callback( false );
    }
    console.log( "Succeeded in sending email to ", to );
    callback( true );
  } );
}

function sendVerificationEmailInternal( req, callback ) {
  VerificationToken.findOne( {
    email: req.body.email
  }, (findErr, existingToken) => {
    const token = md5.hash( req.body.email + String( Date.now() ) );
    let verificationToken = null;
    if ( findErr || !existingToken ) {
      verificationToken = new VerificationToken( {
        email: req.body.email
      } );
    } else {
      verificationToken = existingToken;
      existingToken.createdAt = Date.now();
    }
    verificationToken.setToken( token );
    const verificationURL = req.protocol + "://" + req.get( 'host' ) + "/verify/" + token;
    return sendEmail( req.body.email,
      'Verify your Portfolio Rebalancer email address',
      'Thanks for registering for PortfolioRebalancer.com. Click the following link to verify your email address: ' + verificationURL + '. This link will expire within 24 hours.',
      '<p>Thanks for registering for <a href=https://www.portfoliorebalancer.com>PortfolioRebalancer.com</a>! </p>'
        + '<p> Click the following link to verify your email address: <br/>'
        + '<a href=' + verificationURL + '>' + verificationURL + '</a></p>'
        + '<p>This link will expire within 24 hours.</p>',
      (emailSentSuccessfully) => {
        callback( emailSentSuccessfully );
      } );
  } );
}

export function sendVerificationEmail( req, res, next ) {
  User.findOne( {
    email: req.body.email
  }, (findErr, existingUser) => {
    if ( findErr || !existingUser ) {
      return res.status( 401 ).json( {
        response: constants.RESPONSE_SEND_VERIFICATION_EMAIL_NOT_FOUND
      } );
    }

    sendVerificationEmailInternal( req, (emailSentSuccessfully) => {
      if ( !emailSentSuccessfully ) {
        return res.status( 401 ).json( {
          response: constants.RESPONSE_SEND_VERIFICATION_EMAIL_FAILURE
        } );
      }
      return res.status( 200 ).json( {
        response: constants.RESPONSE_SEND_VERIFICATION_EMAIL_SUCCESS
      } );
    } );
  } );
}

export function sendPasswordReset( req, res, next ) {
  User.findOne( {
    email: req.body.email
  }, (findErr, existingUser) => {
    if ( findErr || !existingUser ) {
      return res.status( 400 ).json( {
        response: constants.RESPONSE_SEND_PASSWORD_RESET_NOT_FOUND,
      } );
    }
    const token = md5.hash( req.body.email + String( Date.now() ) );
    const passwordResetToken = new PasswordResetToken( {
      email: req.body.email
    } );
    passwordResetToken.setToken( token );
    const passwordResetURL = req.protocol + "://" + req.get( 'host' ) + "/reset/" + token;

    sendEmail( req.body.email,
      'Portfolio Rebalancer password reset',
      'Thanks for registering for Portfolio Rebalancer.',
      '<p>Click the following link to reset your password: <a href=' + passwordResetURL + '>' + passwordResetURL + '</a> </p>'
        + '<p>If you did not request this password reset, ignore this email. The link will expire within 24 hours of being sent.',
      (emailSentSuccessfully) => {
        if ( !emailSentSuccessfully ) {
          return res.status( 409 ).json( {
            response: constants.RESPONSE_SEND_PASSWORD_RESET_FAILURE
          } );
        }
        console.log( "Success" );
        console.log( res );

        return res.status( 200 ).json( {
          response: constants.RESPONSE_SEND_PASSWORD_RESET_SUCCESS
        } );
      }
    );
  } );
}

export function changePassword( req, res ) {
  User.findOne( {
    email: req.body.email
  }, function ( err, user ) {
    if ( err || !user ) {
      return res.status( 401 ).json( {
        response: constants.RESPONSE_PASSWORD_USER_NOT_FOUND
      } );
    }
    user.comparePassword( req.body.currentPassword, (err, isMatch) => {
      if ( err ) {
        return res.status( 401 ).json( {
          response: constants.RESPONSE_PASSWORD_RESET_FAILURE
        } );
      }
      if ( !isMatch ) {
        return res.status( 401 ).json( {
          response: constants.RESPONSE_PASSWORD_RESET_INVALID_PASSWORD
        } );
      }

      user[ "password" ] = req.body.newPassword;
      user.save( function ( err ) {
        if ( err ) {
          return res.status( 401 ).json( {
            response: constants.RESPONSE_PASSWORD_RESET_FAILURE
          } );
        }
        return res.status( 200 ).json( {
          response: constants.RESPONSE_PASSWORD_RESET_SUCCESS
        } );
      } );
    } );
  } );
}

export default {
  login,
  logout,
  isEmailAddressAvailable,
  register,
  sendVerificationEmail,
  dbVerify,
  sendPasswordReset,
  changePassword
};
