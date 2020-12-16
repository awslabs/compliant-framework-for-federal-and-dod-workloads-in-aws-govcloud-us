#!/bin/bash

echo $1
echo $2

cd ../$1

BASENAME=`basename "$PWD"`

[ -e $BASENAME.zip ] rm $BASENAME.zip
zip -r $BASENAME.zip *
aws s3 cp $BASENAME.zip s3://$2 --sse aws:kms
rm $BASENAME.zip

cd $PWD